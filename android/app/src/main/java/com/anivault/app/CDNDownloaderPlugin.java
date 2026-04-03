package com.anivault.app;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;

/**
 * CDNDownloaderPlugin — Downloads CDN resources using a hidden WebView that
 * inherits the embed page's CORS origin, cookies, and Chrome TLS fingerprint.
 *
 * Flow:
 * 1. resolveStream(embedUrl) — loads embed page, captures m3u8 URL via
 *    shouldInterceptRequest + injected JS hooks, KEEPS WebView alive.
 * 2. fetchText(url) / fetchSegment(url) — uses the same WebView to download
 *    playlists and segments with the correct origin context.
 * 3. destroy() — cleans up.
 */
@CapacitorPlugin(name = "CDNDownloader")
public class CDNDownloaderPlugin extends Plugin {

    private static final String TAG = "CDNDownloader";
    private static final String UA =
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    private volatile WebView dlWebView;
    private volatile boolean ready = false;
    private volatile PluginCall pendingCall = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // resolveStream state
    private volatile WebView resolveWv = null;
    private volatile PluginCall resolveCall = null;
    private Runnable resolveTimeout = null;

    /* ── init: origin-based WebView (fallback for direct m3u8 URLs) ── */

    @PluginMethod
    public void init(PluginCall call) {
        String originUrl = call.getString("originUrl", "https://megacloud.blog/");
        mainHandler.post(() -> {
            try {
                if (dlWebView != null && ready) { call.resolve(); return; }
                destroyAll();
                dlWebView = makeWV();
                dlWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String u) {
                        Log.d(TAG, "init loaded: " + u);
                        ready = true;
                        call.resolve();
                    }
                    @Override
                    public void onReceivedError(WebView v, WebResourceRequest r,
                            android.webkit.WebResourceError e) {
                        ready = true;
                        call.resolve();
                    }
                });
                dlWebView.loadUrl(originUrl);
            } catch (Exception e) {
                call.reject("init: " + e.getMessage());
            }
        });
    }

    /* ── resolveStream: load embed, capture m3u8, keep WebView for downloads ── */

    @PluginMethod
    public void resolveStream(PluginCall call) {
        String embedUrl = call.getString("embedUrl");
        if (embedUrl == null) { call.reject("embedUrl required"); return; }
        Log.d(TAG, "resolveStream: " + embedUrl);

        mainHandler.post(() -> {
            try {
                destroyAll();
                final WebView wv = makeWV();
                resolveWv = wv;
                resolveCall = call;

                resolveTimeout = () -> completeResolve(null, "Timeout: embed did not request m3u8 within 30s");
                mainHandler.postDelayed(resolveTimeout, 30000);

                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                        String url = req.getUrl().toString();
                        if (url.toLowerCase().contains(".m3u8")) {
                            completeResolve(url, null);
                        }
                        return null;
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        Log.d(TAG, "Embed loaded: " + url);
                        if (resolveCall != null) {
                            view.evaluateJavascript(captureJS(), null);
                        }
                    }
                });

                HashMap<String, String> headers = new HashMap<>();
                headers.put("Referer", "https://aniwatchtv.to/");
                wv.loadUrl(embedUrl, headers);
            } catch (Exception e) {
                Log.e(TAG, "resolveStream fail", e);
                call.reject(e.getMessage());
            }
        });
    }

    /** Thread-safe handler — called from shouldInterceptRequest or JS hook. */
    private synchronized void completeResolve(String url, String err) {
        PluginCall c = resolveCall;
        if (c == null) return;
        resolveCall = null;
        if (resolveTimeout != null) {
            mainHandler.removeCallbacks(resolveTimeout);
            resolveTimeout = null;
        }
        if (url != null) {
            Log.d(TAG, "m3u8 captured: " + url.substring(0, Math.min(80, url.length())));
            dlWebView = resolveWv;
            resolveWv = null;
            ready = true;
            JSObject r = new JSObject();
            r.put("url", url);
            c.resolve(r);
        } else {
            Log.w(TAG, "resolve fail: " + err);
            c.reject(err != null ? err : "resolve failed");
            final WebView w = resolveWv;
            resolveWv = null;
            if (w != null) mainHandler.post(() -> { w.stopLoading(); w.destroy(); });
        }
    }

    /* ── fetchText / fetchSegment: use the kept-alive download WebView ── */

    @PluginMethod
    public void fetchText(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("url required"); return; }
        if (!ready || dlWebView == null) { call.reject("Not initialized"); return; }
        pendingCall = call;
        mainHandler.post(() -> {
            try {
                dlWebView.evaluateJavascript(
                    "(function(){fetch('" + esc(url) + "',{credentials:'omit'})" +
                    ".then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.text();})" +
                    ".then(function(t){_dlBridge.onTextData(t);})" +
                    ".catch(function(e){_dlBridge.onError(e.message||'fail');});})();", null);
            } catch (Exception e) { errPending("eval: " + e.getMessage()); }
        });
    }

    @PluginMethod
    public void fetchSegment(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("url required"); return; }
        if (!ready || dlWebView == null) { call.reject("Not initialized"); return; }
        pendingCall = call;
        mainHandler.post(() -> {
            try {
                dlWebView.evaluateJavascript(
                    "(function(){fetch('" + esc(url) + "',{credentials:'omit'})" +
                    ".then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.blob();})" +
                    ".then(function(b){return new Promise(function(ok,no){" +
                    "var r=new FileReader();r.onload=function(){ok(r.result);};r.onerror=function(){no(r.error);};" +
                    "r.readAsDataURL(b);});})" +
                    ".then(function(d){_dlBridge.onSegmentData(d);})" +
                    ".catch(function(e){_dlBridge.onError(e.message||'fail');});})();", null);
            } catch (Exception e) { errPending("eval: " + e.getMessage()); }
        });
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        mainHandler.post(this::destroyAll);
        call.resolve();
    }

    // ══════════ Helpers ══════════

    private WebView makeWV() {
        WebView wv = new WebView(getContext());
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowContentAccess(true);
        s.setUserAgentString(UA);
        wv.addJavascriptInterface(new DLBridge(), "_dlBridge");
        return wv;
    }

    private void destroyAll() {
        if (dlWebView != null) {
            dlWebView.stopLoading();
            dlWebView.destroy();
            dlWebView = null;
            ready = false;
        }
        if (resolveWv != null) {
            resolveWv.stopLoading();
            resolveWv.destroy();
            resolveWv = null;
        }
    }

    /** JS injected into embed page to hook fetch/XHR and poll video elements. */
    private String captureJS() {
        return "(function(){" +
            "if(window.__avHk)return;window.__avHk=true;var d=false;" +
            "function h(u){if(d||!u)return;u=''+u;" +
            "if(u.indexOf('.m3u8')>-1){d=true;_dlBridge.onStreamUrl(u);}}" +
            "var _f=window.fetch;" +
            "window.fetch=function(){var a=arguments[0];" +
            "h((a&&a.url)?a.url:typeof a==='string'?a:'');" +
            "return _f.apply(this,arguments);};" +
            "var _o=XMLHttpRequest.prototype.open;" +
            "XMLHttpRequest.prototype.open=function(){h(arguments[1]);" +
            "return _o.apply(this,arguments);};" +
            "var iv=setInterval(function(){if(d){clearInterval(iv);return;}" +
            "var e=document.querySelectorAll('video,source');" +
            "for(var i=0;i<e.length;i++){" +
            "var s=e[i].src||e[i].currentSrc||e[i].getAttribute('src')||'';" +
            "h(s);}},500);" +
            "})();";
    }

    private String esc(String s) {
        return s.replace("\\", "\\\\").replace("'", "\\'")
                .replace("\n", "").replace("\r", "");
    }

    private void errPending(String m) {
        PluginCall c = pendingCall;
        pendingCall = null;
        if (c != null) c.reject(m);
    }

    // ══════════ JavaScript Bridge ══════════

    private class DLBridge {
        @JavascriptInterface
        public void onSegmentData(String dataUrl) {
            PluginCall c = pendingCall;
            pendingCall = null;
            if (c != null) {
                JSObject r = new JSObject();
                r.put("data", dataUrl);
                c.resolve(r);
            }
        }

        @JavascriptInterface
        public void onTextData(String text) {
            PluginCall c = pendingCall;
            pendingCall = null;
            if (c != null) {
                JSObject r = new JSObject();
                r.put("text", text);
                c.resolve(r);
            }
        }

        /** Called by injected JS hooks when m3u8 URL is captured. */
        @JavascriptInterface
        public void onStreamUrl(String url) {
            Log.d(TAG, "JS hook captured: " + (url != null ? url.substring(0, Math.min(80, url.length())) : "null"));
            if (url != null && !url.isEmpty()) {
                completeResolve(url, null);
            }
        }

        @JavascriptInterface
        public void onError(String message) {
            Log.w(TAG, "error: " + message);
            PluginCall c = pendingCall;
            pendingCall = null;
            if (c != null) c.reject(message);
        }
    }
}
