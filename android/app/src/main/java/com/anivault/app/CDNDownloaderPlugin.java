package com.anivault.app;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * CDNDownloaderPlugin — fetches CDN resources (HLS segments, m3u8 playlists)
 * using a hidden WebView loaded on the megacloud.blog origin.
 *
 * Why: CapacitorHttp routes fetch() through Android's native HTTP
 * (HttpURLConnection) which has a different TLS fingerprint than Chrome.
 * CDN anti-bot systems detect this and return 403. The hidden WebView uses
 * Chrome's real engine with proper TLS AND the correct CORS origin.
 */
@CapacitorPlugin(name = "CDNDownloader")
public class CDNDownloaderPlugin extends Plugin {

    private static final String TAG = "CDNDownloader";
    private WebView dlWebView;
    private volatile boolean ready = false;
    private volatile PluginCall pendingCall = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void init(PluginCall call) {
        String originUrl = call.getString("originUrl", "https://megacloud.blog/");

        mainHandler.post(() -> {
            try {
                if (dlWebView != null && ready) {
                    call.resolve();
                    return;
                }

                dlWebView = new WebView(getContext());
                WebSettings s = dlWebView.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

                dlWebView.addJavascriptInterface(new DLBridge(), "_dlBridge");

                dlWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        Log.d(TAG, "Hidden WebView loaded: " + url);
                        ready = true;
                        call.resolve();
                    }

                    @Override
                    public void onReceivedError(WebView view, WebResourceRequest request,
                                                WebResourceError error) {
                        // Even on error, origin is set — we can still run fetch()
                        Log.w(TAG, "Hidden WebView error, but origin is set");
                        ready = true;
                        call.resolve();
                    }
                });

                dlWebView.loadUrl(originUrl);
            } catch (Exception e) {
                Log.e(TAG, "init failed", e);
                call.reject("Failed to init: " + e.getMessage());
            }
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
                String safeUrl = url.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "");
                String js =
                    "(function(){" +
                    "fetch('" + safeUrl + "',{credentials:'omit'})" +
                    ".then(function(r){" +
                    "  if(!r.ok)throw new Error('HTTP '+r.status);" +
                    "  return r.blob();" +
                    "})" +
                    ".then(function(b){" +
                    "  return new Promise(function(res,rej){" +
                    "    var rd=new FileReader();" +
                    "    rd.onload=function(){res(rd.result);};" +
                    "    rd.onerror=function(){rej(rd.error);};" +
                    "    rd.readAsDataURL(b);" +
                    "  });" +
                    "})" +
                    ".then(function(d){_dlBridge.onSegmentData(d);})" +
                    ".catch(function(e){_dlBridge.onError(e.message||'failed');});" +
                    "})();";

                dlWebView.evaluateJavascript(js, null);
            } catch (Exception e) {
                resolvePendingError("eval failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void fetchText(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("url required"); return; }
        if (!ready || dlWebView == null) { call.reject("Not initialized"); return; }

        pendingCall = call;

        mainHandler.post(() -> {
            try {
                String safeUrl = url.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "");
                String js =
                    "(function(){" +
                    "fetch('" + safeUrl + "',{credentials:'omit'})" +
                    ".then(function(r){" +
                    "  if(!r.ok)throw new Error('HTTP '+r.status);" +
                    "  return r.text();" +
                    "})" +
                    ".then(function(t){_dlBridge.onTextData(t);})" +
                    ".catch(function(e){_dlBridge.onError(e.message||'failed');});" +
                    "})();";

                dlWebView.evaluateJavascript(js, null);
            } catch (Exception e) {
                resolvePendingError("eval failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        mainHandler.post(() -> {
            if (dlWebView != null) {
                dlWebView.destroy();
                dlWebView = null;
                ready = false;
            }
        });
        call.resolve();
    }

    private void resolvePendingError(String msg) {
        PluginCall c = pendingCall;
        pendingCall = null;
        if (c != null) c.reject(msg);
    }

    private class DLBridge {
        @JavascriptInterface
        public void onSegmentData(String dataUrl) {
            PluginCall c = pendingCall;
            pendingCall = null;
            if (c != null) {
                JSObject ret = new JSObject();
                ret.put("data", dataUrl);
                c.resolve(ret);
            }
        }

        @JavascriptInterface
        public void onTextData(String text) {
            PluginCall c = pendingCall;
            pendingCall = null;
            if (c != null) {
                JSObject ret = new JSObject();
                ret.put("text", text);
                c.resolve(ret);
            }
        }

        @JavascriptInterface
        public void onError(String message) {
            Log.w(TAG, "fetch error: " + message);
            PluginCall c = pendingCall;
            pendingCall = null;
            if (c != null) c.reject(message);
        }
    }
}
