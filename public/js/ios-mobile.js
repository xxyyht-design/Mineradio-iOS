/* ============================================================
   ios-mobile.js — iPhone / Capacitor 专用运行时补丁
   1) 打 body.ios-capacitor 标记（CSS 覆盖层的开关）
   2) 登录节点连线：把「按住拖线」改成「点端口 → 点 MR」两步点击
   3) 横屏时放开纵向滚动
   ============================================================ */
(function () {
  'use strict';

  function isCapacitorIOS() {
    if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
      return window.Capacitor.getPlatform() === 'ios';
    }
    if (window.Capacitor) return true;
    // 兜底：iPhone Safari 独立模式也套用移动布局
    var ua = navigator.userAgent || '';
    var isIOSDevice = /iPhone|iPod/.test(ua) ||
      (/iPad|Macintosh/.test(ua) && 'ontouchend' in document);
    return isIOSDevice && !!window.navigator.standalone;
  }

  var IS_IOS_APP = isCapacitorIOS();

  function markBody() {
    if (!document.body) return;
    if (IS_IOS_APP) {
      document.body.classList.add('ios-capacitor');
      document.documentElement.classList.add('ios-capacitor-root');
    }
  }

  // ---------- 提示条 ----------
  var hintEl = null;
  var hintTimer = 0;

  function showHint(text, ms) {
    if (!IS_IOS_APP) return;
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.id = 'mr-touch-hint';
      document.body.appendChild(hintEl);
    }
    hintEl.textContent = text;
    hintEl.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      if (hintEl) hintEl.classList.remove('show');
    }, ms || 2600);
  }

  function hideHint() {
    clearTimeout(hintTimer);
    if (hintEl) hintEl.classList.remove('show');
  }

  // ---------- 登录连线：两步点击 ----------
  // 原版逻辑在 08-account/03-login-modal-flows.js：
  //   pointerdown 抓 .flow-port.out → pointermove 拖 → pointerup 落在 MR 节点上才连接
  // 手机上手指按住拖很难落准，这里改成：
  //   第一次 tap 出口端口 → 记住 provider（armed）
  //   第二次 tap MR 节点/入口端口 → 直接调用 connectLoginProviderToMr(provider)
  var armedProvider = '';
  var armedPort = null;

  function graphEl() {
    return document.getElementById('login-node-graph');
  }

  function clearArmed() {
    var g = graphEl();
    if (armedPort) armedPort.classList.remove('mr-tap-armed');
    if (g) g.classList.remove('mr-tap-pending');
    armedProvider = '';
    armedPort = null;
    hideHint();
  }

  function providerLabel(key) {
    var map = {
      netease: '网易云音乐',
      qq: 'QQ 音乐',
      kugou: '酷狗音乐',
      qishui: '汽水音乐',
      spotify: 'Spotify'
    };
    return map[key] || key;
  }

  function findProviderFromPort(port) {
    if (!port) return '';
    var direct = port.getAttribute('data-login-provider-output');
    if (direct) return direct;
    var node = port.closest ? port.closest('[data-login-provider]') : null;
    return (node && node.getAttribute('data-login-provider')) || '';
  }

  function isMrTarget(el) {
    if (!el || !el.closest) return false;
    return !!(
      el.closest('[data-login-mr-target="mr"]') ||
      el.closest('[data-login-node="mr"]') ||
      el.closest('.flow-port.in')
    );
  }

  function bindTapToConnect() {
    var g = graphEl();
    if (!g || g._mrTapBound) return;
    g._mrTapBound = true;

    // 用 capture 阶段抢在原版 pointerdown 之前处理，避免原版进入拖拽态
    g.addEventListener('pointerdown', function (e) {
      // 排序把手保持原生行为（长按拖动排序仍可用）
      if (e.target && e.target.closest && e.target.closest('[data-login-provider-sort]')) return;

      var outPort = e.target && e.target.closest ? e.target.closest('.flow-port.out') : null;

      if (outPort && g.contains(outPort)) {
        e.preventDefault();
        e.stopPropagation();
        var provider = findProviderFromPort(outPort);
        if (!provider) return;

        // 再点同一个端口 = 取消
        if (armedProvider === provider) {
          clearArmed();
          showHint('已取消连接', 1400);
          return;
        }

        clearArmed();
        armedProvider = provider;
        armedPort = outPort;
        outPort.classList.add('mr-tap-armed');
        g.classList.add('mr-tap-pending');
        showHint('已选中「' + providerLabel(provider) + '」，现在点中间的 MR 节点完成连接', 4000);
        return;
      }

      if (armedProvider && isMrTarget(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        var p = armedProvider;
        clearArmed();
        try {
          if (typeof window.connectLoginProviderToMr === 'function') {
            window.connectLoginProviderToMr(p);
          } else if (typeof connectLoginProviderToMr === 'function') {
            /* eslint-disable-next-line no-undef */
            connectLoginProviderToMr(p);
          } else {
            showHint('连接函数不可用，请改用桌面端登录', 3000);
            return;
          }
          showHint('已连接「' + providerLabel(p) + '」，请在下方完成登录', 3200);
        } catch (err) {
          showHint('连接失败：' + (err && err.message ? err.message : '未知错误'), 3200);
        }
      }
    }, true);

    // 点空白处取消
    g.addEventListener('pointerdown', function (e) {
      if (!armedProvider) return;
      var onPort = e.target && e.target.closest && e.target.closest('.flow-port');
      if (!onPort && !isMrTarget(e.target)) clearArmed();
    }, false);
  }

  // 登录弹窗是懒加载的，用 MutationObserver 等它出现
  function watchForLoginGraph() {
    if (!IS_IOS_APP) return;
    bindTapToConnect();
    var mo = new MutationObserver(function () {
      bindTapToConnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---------- 横屏滚动 ----------
  function applyOrientationScroll() {
    if (!IS_IOS_APP) return;
    var landscape = window.matchMedia('(orientation: landscape)').matches;
    document.body.classList.toggle('mr-landscape', landscape);
    // 横屏内容超高时允许纵向滚动；竖屏锁死避免橡皮筋
    document.body.style.overflowY = landscape ? 'auto' : 'hidden';
  }

  // ---------- 启动 ----------
  function boot() {
    markBody();
    if (!IS_IOS_APP) return;
    applyOrientationScroll();
    watchForLoginGraph();
    window.addEventListener('orientationchange', function () {
      setTimeout(applyOrientationScroll, 220);
    });
    window.addEventListener('resize', applyOrientationScroll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.MineradioIOS = {
    isIOSApp: IS_IOS_APP,
    showHint: showHint
  };
})();
