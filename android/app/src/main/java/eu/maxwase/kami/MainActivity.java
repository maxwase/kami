package eu.maxwase.kami;

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Pointer gestures drive the fold; the overscroll glow fights them
        // (Android counterpart of `ios.scrollEnabled: false`).
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
    }
}
