package com.anivault.app;

import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
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

/**
 * CDNDownloaderPlugin — fetches CDN resources (HLS segments, m3u8 playlists)
 * using a hidden WebView loaded on the megacloud.blog origin.
 *
 * Also resolves stream URLs by loading embed pages and intercepting the
 * m3u8 requests that the embed's own JavaScript makes (handles encrypted
 * sources that our JS scraper can't decrypt).
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

    /**
     * Load an embed page in a temporary WebView and intercept the m3u8 URL
     * that the page's own HLS.js requests. This handles encrypted sources
     * because the embed page's JavaScript does the decryption.
     */
    @PluginMethod
    public void resolveStream(PluginCall call) {
        String embedUrl = call.getString("embedUrl");
        if (embedUrl == null) { call.reject("embedUrl required"); return; }

        Log.d(TAG, "resolveStream: " + embedUrl);

        mainHandler.post(() -> {
            try {
                final WebView resolveWV = new WebView(getContext());
                WebSettings s = resolveWV.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                s.setMediaPlaybackRequiresUserGesture(false);

                final boolean[] resolved = {false};

                // Timeout after 20 seconds
                Runnable timeout = () -> {
                    if (!resolved[0]) {
                        resolved[0] = true;
                        Log.w(TAG, "resolveStream timeout");
                        call.reject("Timeout: embed page did not request m3u8");
                        resolveWV.stopLoading();
                        resolveWV.destroy();
                    }
                };
                mainHandler.postDelayed(timeout, 20000);

                resolveWV.setWebViewClient(new WebViewClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        String url = request.getUrl().toString();
                        // Capture .m3u8 requests (the actual stream URL)
                        if (!resolved[0] && url.contains(".m3u8")) {
                            resolved[0] = true;
                            mainHandler.removeCallbacks(timeout);
                            Log.d(TAG, "Captured m3u8 URL: " + url.substring(0, Math.min(80, url.length())));
                            JSObject ret = new JSObject();
                            ret.put("url", url);
                            call.resolve(ret);
                            mainHandler.post(() -> {
                                view.stopLoading();
                                view.destroy();
                            });
                        }
                        return null; // Let Chrome handle the actual request
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        Log.d(TAG, "Embed page loaded: " + url);
                    }
                });

                resolveWV.loadUrl(embedUrl);
            } catch (Exception e) {
                Log.e(TAG, "resolveStream failed", e);
                call.reject("Failed: " + e.getMessage());
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
