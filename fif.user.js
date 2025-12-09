// ==UserScript==
// @name         人工智能导论（全自动刷课）
// @namespace    http://tampermonkey.net/
// @version      9.0.1
// @description  按“本节资源”列表顺序刷：PPT翻页(.pptBtn .arrow-right) + 视频16倍速 + 文档滚动；所有资源100%后才点“继续学习下一节”。列表无未完成资源时直接跳下一节。
// @author       TargetKiller (fix by CarlSkyCoding)
// @match        *://icourse.fifedu.com/*
// @match        *://resc.fifedu.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /********************
     * 全局状态 & 常量
     ********************/
    let isScriptRunning = true;
    const CHECK_INTERVAL = 500;
    const PAGE_READY_WAIT_MS = 5000;
    const DOC_FINISH_WAIT = 3000;
    const NEXT_SECTION_TEXT = '继续学习下一节';

    const PPT_NEXT_SELECTORS = [
        '.pptBtn .arrow-right',
        '.pptBtn',
        '.fa-chevron-right',
        '.fa-arrow-right',
        '.fa-caret-right',
        '.icon-arrow-right',
        '.pdfViewer .pageDown',
        'div[class*="arrow-right"]',
        'button[title="下一页"]',
        'button[title="Next"]'
    ];

    console.log('>>> V9.0 精简整理版脚本已加载...');

    /********************
     * 伪装前台 & 防休眠
     ********************/
    try {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    } catch (e) { }

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            const ctx = new AudioContext();
            setInterval(() => {
                if (!isScriptRunning) return;
                if (ctx.state === 'suspended') ctx.resume();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(0);
                osc.stop(0.001);
            }, 10000);
        }
    } catch (e) { }

    window.addEventListener('load', () => {
        /********************
         * 页面类型判断
         ********************/
        const isPdfViewerPage = (() => {
            try {
                const host = location.hostname || '';
                const path = location.pathname || '';
                // resc.fifedu.com/iplat-resc/pdfv-resource/web/viewer.html?file=...
                return host.includes('resc.fifedu.com') && path.includes('/pdfv-resource/web/viewer');
            } catch (e) {
                return false;
            }
        })();

        /********************
         * UI 面板
         ********************/
        const panel = document.createElement('div');
        panel.style.cssText = [
            'position:fixed',
            'top:50px',
            'left:10px',
            'background:rgba(0,0,0,0.85)',
            'color:#fff',
            'padding:10px',
            'z-index:999999',
            'border-radius:8px',
            'font-size:13px',
            'font-family:sans-serif',
            'border:1px solid #444',
            'min-width:180px'
        ].join(';');

        const statusText = document.createElement('div');
        statusText.innerText = '全能模式运行中...';
        statusText.style.cssText = 'margin-bottom:8px;color:#2ecc71;font-weight:bold;';

        const toggleBtn = document.createElement('button');
        toggleBtn.innerText = '⏸ 暂停脚本';
        toggleBtn.style.cssText = [
            'width:100%',
            'padding:5px 0',
            'cursor:pointer',
            'background:#e74c3c',
            'color:#fff',
            'border:none',
            'border-radius:4px',
            'font-weight:bold'
        ].join(';');

        const logArea = document.createElement('div');
        logArea.style.cssText = 'margin-top:8px;font-size:11px;color:#aaa;border-top:1px solid #555;padding-top:5px;';
        logArea.innerText = '准备就绪...';

        toggleBtn.onclick = () => {
            isScriptRunning = !isScriptRunning;
            if (isScriptRunning) {
                toggleBtn.innerText = '⏸ 暂停脚本';
                toggleBtn.style.background = '#e74c3c';
                statusText.innerText = '全能模式运行中...';
                statusText.style.color = '#2ecc71';
            } else {
                toggleBtn.innerText = '▶ 恢复运行';
                toggleBtn.style.background = '#2ecc71';
                statusText.innerText = '脚本已暂停';
                statusText.style.color = '#f1c40f';
            }
        };

        panel.appendChild(statusText);
        panel.appendChild(toggleBtn);
        panel.appendChild(logArea);
        document.body.appendChild(panel);

        function updateLog(msg, color = '#aaa') {
            if (!isScriptRunning) return;
            logArea.innerText = msg;
            logArea.style.color = color;
        }

        /********************
         * 运行时局部状态
         ********************/
        const pageLoadTime = Date.now();
        let docScrollFinished = false;
        let lastScrollBottomTime = 0;
        let hasAnyResourceSeen = false;

        /********************
         * 核心循环
         ********************/
        setInterval(() => {
            if (!isScriptRunning) return;

            const pageStable = Date.now() - pageLoadTime >= PAGE_READY_WAIT_MS;

            // 1. 分析“本节资源”列表
            const resourceState = analyzeActivityList();
            if (resourceState.hasAnyResource) hasAnyResourceSeen = true; // 当前版本暂未用到 hasAnyResourceSeen，但保留变量

            // 2. 若有未完成资源，保证当前激活的是第一个未完成资源
            if (resourceState.hasAnyResource && resourceState.hasUnfinished) {
                const { activeItem, firstUnfinishedItem } = resourceState;
                if (!activeItem || isResourceFinished(activeItem)) {
                    if (firstUnfinishedItem) {
                        updateLog(
                            '切换到未完成资源: ' + (getResourceTitle(firstUnfinishedItem) || ''),
                            '#f39c12'
                        );
                        clickElementSafe(firstUnfinishedItem);
                        return; // 等资源切换后下次循环再处理
                    }
                }
            }

            // 3. 内容区域资源检测
            const activeItem = resourceState.activeItem;
            const activeType = activeItem ? getResourceType(activeItem) : null; // "PPT" / "视频" / 其它

            const video = findVideo();
            const pptInfo = detectPPT();
            const docInfo = detectScrollableDoc();

            if (video || pptInfo.hasPPT || docInfo.hasDoc) {
                hasAnyResourceSeen = true;
            }

            const videoFinished = video ? isVideoFinished(video) : true;
            const pptFinished = pptInfo.hasPPT
                ? pptInfo.current >= pptInfo.total && pptInfo.total > 0
                : true;

            // 4. 按激活资源类型依次处理

            // 4.1 视频优先
            if (activeType === '视频' && video && !videoFinished) {
                handleVideo(video);
                return;
            }

            // 4.2 PPT 其次
            if (activeType === 'PPT' && pptInfo.hasPPT && !pptFinished) {
                handlePPT(pptInfo);
                return;
            }

            // 4.3 其它类型：文档滚动（仅 PDF viewer 页面）
            const docState = handleDocumentScroll();
            const allContentFinishedForActive =
                (activeType !== '视频' || videoFinished) &&
                (activeType !== 'PPT' || pptFinished) &&
                docState.finished;

            // 5. 跳转下一节逻辑

            // 5.1 本节没有任何资源：直接跳
            if (pageStable && !resourceState.hasAnyResource) {
                updateLog('本节没有任何资源，自动点击「继续学习下一节」...', '#00ffff');
                clickNextSectionButton();
                return;
            }

            // 5.2 有资源，但列表中不存在未完成资源：也跳
            if (pageStable && resourceState.hasAnyResource && !resourceState.hasUnfinished) {
                // 这里不会强依赖 allContentFinishedForActive，因为进度以平台记录为准
                updateLog('本节资源列表均无未完成项，点击「继续学习下一节」...', '#00ffff');
                clickNextSectionButton();
                return;
            }

            // 调试状态输出
            const statusPieces = [
                `页面稳定:${pageStable ? '是' : '否'}`,
                `本节有资源:${resourceState.hasAnyResource ? '是' : '否'}`,
                `存在未完成资源:${resourceState.hasUnfinished ? '是' : '否'}`,
                `当前类型:${activeType || '无'}`,
                `视频完:${videoFinished ? '是' : '否'}`,
                `PPT完:${pptFinished ? '是' : '否'}`,
                `文档完:${docState.finished ? '是' : '否'}`
            ];
            updateLog(statusPieces.join(' | '), '#bdc3c7');
        }, CHECK_INTERVAL);

        /********************
         * 本节资源列表解析
         ********************/
        function analyzeActivityList() {
            const container = document.querySelector(
                '.activity-list.activity-list-warp .scroll-inner'
            );
            if (!container) {
                return emptyActivityState();
            }

            const items = Array.from(container.querySelectorAll('.activity-list-item'));
            if (!items.length) {
                return emptyActivityState();
            }

            let activeItem = null;
            let firstUnfinishedItem = null;
            let hasUnfinished = false;

            for (const it of items) {
                if (it.classList.contains('is-active')) {
                    activeItem = it;
                }
                if (!isResourceFinished(it)) {
                    hasUnfinished = true;
                    if (!firstUnfinishedItem) {
                        firstUnfinishedItem = it;
                    }
                }
            }

            return {
                hasAnyResource: true,
                hasUnfinished,
                activeItem,
                firstUnfinishedItem
            };
        }

        function emptyActivityState() {
            return {
                hasAnyResource: false,
                hasUnfinished: false,
                activeItem: null,
                firstUnfinishedItem: null
            };
        }

        // 判断资源是否“完成”
        function isResourceFinished(item) {
            try {
                const statusSpans = item.querySelectorAll('.status-flex .activityStatus span');
                if (!statusSpans || statusSpans.length < 2) return false;

                const progressText = statusSpans[1].innerText.trim(); // 如 "已学 8%" / "未开始"
                if (!progressText) return false;

                if (
                    progressText.includes('未开始') ||
                    progressText.includes('未完成') ||
                    progressText.includes('学习中')
                ) {
                    return false;
                }

                const match = progressText.match(/已学\s*(\d+)%/);
                if (match) {
                    const percent = parseInt(match[1], 10);
                    return percent >= 100;
                }

                if (progressText.includes('已完成') || progressText.includes('完成')) {
                    return true;
                }

                return false;
            } catch (e) {
                return false;
            }
        }

        function getResourceType(item) {
            try {
                const typeSpan = item.querySelector('.status-flex .activityStatus span');
                return typeSpan ? typeSpan.innerText.trim() : null;
            } catch (e) {
                return null;
            }
        }

        function getResourceTitle(item) {
            try {
                const titleSpan = item.querySelector('.right-content-text span');
                return titleSpan ? titleSpan.innerText.trim() : '';
            } catch (e) {
                return '';
            }
        }

        /********************
         * 视频相关
         ********************/
        function findVideo(root = document) {
            const v = root.querySelector('video');
            if (v) return v;

            const all = root.querySelectorAll('*');
            for (const el of all) {
                if (el.shadowRoot) {
                    const sv = findVideo(el.shadowRoot);
                    if (sv) return sv;
                }
            }
            return null;
        }

        function isVideoFinished(video) {
            if (!video) return true;
            return (
                video.ended ||
                (video.duration > 0 && video.currentTime >= video.duration - 0.5)
            );
        }

        function handleVideo(video) {
            if (!video.muted) video.muted = true;
            try {
                if (video.playbackRate !== 16.0) {
                    video.playbackRate = 16.0;
                }
            } catch (e) { }

            if (isVideoFinished(video)) {
                updateLog('视频已看完，等待资源列表状态刷新...', '#f1c40f');
                return;
            }

            if (video.paused) {
                updateLog(
                    `视频暂停，强制唤醒 (倍速: ${video.playbackRate || '未知'})`,
                    '#e74c3c'
                );
                video
                    .play()
                    .catch(() =>
                        video.dispatchEvent(
                            new MouseEvent('click', { bubbles: true, cancelable: true })
                        )
                    );
            } else {
                const percent =
                    video.duration > 0
                        ? ((video.currentTime / video.duration) * 100).toFixed(1)
                        : '0.0';
                const rate = video.playbackRate?.toFixed
                    ? video.playbackRate.toFixed(1)
                    : video.playbackRate;
                updateLog(`视频进度: ${percent}% | 倍速: ${rate}`, '#2ecc71');
            }
        }

        /********************
         * PPT 相关
         ********************/
        function detectPPT() {
            const nodes = document.querySelectorAll('div, span, p');
            for (const el of nodes) {
                const text = (el.innerText || '').trim();
                if (!text) continue;

                const match = text.match(/(\d+)\s*\/\s*(\d+)/); // 29 / 34
                if (!match) continue;

                const current = parseInt(match[1], 10);
                const total = parseInt(match[2], 10);
                if (!isNaN(current) && !isNaN(total) && total > 0 && current <= total) {
                    return { hasPPT: true, current, total, element: el };
                }
            }
            return { hasPPT: false, current: 0, total: 0, element: null };
        }

        function handlePPT(pptInfo) {
            if (!pptInfo.hasPPT) return;

            if (pptInfo.current < pptInfo.total) {
                updateLog(
                    `PPT翻页中: ${pptInfo.current} / ${pptInfo.total}`,
                    '#3498db'
                );
                clickPPTNextButton();
            } else {
                updateLog('PPT已翻到最后一页', '#2ecc71');
            }
        }

        function clickPPTNextButton() {
            for (const selector of PPT_NEXT_SELECTORS) {
                const btns = document.querySelectorAll(selector);
                for (const btn of btns) {
                    if (!btn) continue;

                    // 对 img.arrow-right 优先点父级 span.pptBtn
                    if (
                        btn.tagName === 'IMG' &&
                        btn.classList.contains('arrow-right') &&
                        btn.parentElement &&
                        btn.parentElement.classList.contains('pptBtn') &&
                        btn.parentElement.offsetParent !== null
                    ) {
                        clickElementSafe(btn.parentElement);
                        return;
                    }

                    if (btn.offsetParent !== null) {
                        clickElementSafe(btn);
                        return;
                    }
                }
            }
        }

        /********************
         * 文档滚动 (仅 PDF viewer 页面)
         ********************/
        function detectScrollableDoc() {
            // 在 icourse 主页面不检测文档滚动，避免乱滚主页面
            if (!isPdfViewerPage) return { hasDoc: false };

            let hasDoc = false;
            const docEl = document.documentElement;
            const body = document.body || {};
            const scrollHeight = docEl.scrollHeight || body.scrollHeight || 0;
            const clientHeight = docEl.clientHeight || body.clientHeight || 0;

            if (scrollHeight > clientHeight + 50) {
                hasDoc = true;
            }

            const divs = document.querySelectorAll('div');
            for (const div of divs) {
                if (div.scrollHeight > div.clientHeight && div.clientHeight > 200) {
                    hasDoc = true;
                    break;
                }
            }
            return { hasDoc };
        }

        function handleDocumentScroll() {
            // 在 icourse 主页面：认为文档已完成，不滚主页面
            if (!isPdfViewerPage) {
                docScrollFinished = true;
                return { finished: true };
            }

            const now = Date.now();
            let mainFinished = false;
            let innerFinished = true;
            let hasScrollableInner = false;

            const docEl = document.documentElement;
            const body = document.body || {};
            const scrollHeight = docEl.scrollHeight || body.scrollHeight || 0;
            const clientHeight = docEl.clientHeight || body.clientHeight || 0;
            const atBottomMain = window.scrollY + clientHeight >= scrollHeight - 10;

            if (!atBottomMain && scrollHeight > clientHeight + 50) {
                updateLog('正在阅读文档(滚动 PDF 页面)...', '#9b59b6');
                window.scrollBy(0, 500);
                mainFinished = false;
            } else {
                mainFinished = true;
            }

            const divs = document.querySelectorAll('div');
            for (const div of divs) {
                if (div.scrollHeight > div.clientHeight && div.clientHeight > 200) {
                    hasScrollableInner = true;
                    const atBottom =
                        div.scrollTop + div.clientHeight >= div.scrollHeight - 10;
                    if (!atBottom) {
                        innerFinished = false;
                        div.scrollTop += 400;
                    }
                }
            }

            if (!hasScrollableInner && scrollHeight <= clientHeight + 50) {
                docScrollFinished = true;
                return { finished: true };
            }

            if (mainFinished && innerFinished) {
                if (!docScrollFinished) {
                    if (!lastScrollBottomTime) {
                        lastScrollBottomTime = now;
                    }
                    if (now - lastScrollBottomTime >= DOC_FINISH_WAIT) {
                        docScrollFinished = true;
                        updateLog('文档滚动已完成', '#1abc9c');
                    }
                }
            } else {
                docScrollFinished = false;
                lastScrollBottomTime = 0;
            }

            return { finished: docScrollFinished };
        }

        /********************
         * 下一节按钮
         ********************/
        function clickNextSectionButton() {
            const btns = document.querySelectorAll(
                '.static-btns-group .el-button, .static-btns-group button'
            );
            for (const btn of btns) {
                if (!btn || btn.offsetParent === null) continue;
                const span = btn.querySelector('span');
                const text = (span ? span.innerText : btn.innerText).trim();
                if (text.includes(NEXT_SECTION_TEXT)) {
                    clickElementSafe(btn);
                    return;
                }
            }

            // 兜底：用文本包含“下一节”的元素
            const xpath = `//*[text()[contains(.,'${NEXT_SECTION_TEXT}') or contains(.,'下一节')]]`;
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );
            for (let i = 0; i < result.snapshotLength; i++) {
                const el = result.snapshotItem(i);
                if (el && el.offsetParent !== null) {
                    clickElementSafe(el);
                    return;
                }
            }
        }

        /********************
         * 通用点击封装
         ********************/
        function clickElementSafe(el) {
            if (!el) return;
            el.click();
            ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => {
                el.dispatchEvent(
                    new MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    })
                );
            });
        }
    });
})();