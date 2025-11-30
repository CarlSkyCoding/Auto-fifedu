// ==UserScript==
// @name         靶机自动刷课脚本 (V8.0 全能通用版)
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  V7基础 + 自动阅读Word文档(滚动) + 自动看完PPT(翻页) + 视频挂机
// @author       TargetKiller
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // === 配置区域 ===
    let isScriptRunning = true; 
    const CHECK_INTERVAL = 1500;
    const NEXT_KEYWORDS = ["下一节", "下一章", "Next", "继续学习", "继续", "完成", "Submit", "提交"];
    
    // PPT 翻页按钮的常见类名 (根据截图推测可能是 font-awesome 或常见的 icon)
    const PPT_NEXT_SELECTORS = [
        '.fa-chevron-right', 
        '.fa-arrow-right', 
        '.fa-caret-right',
        '.icon-arrow-right',
        '.pdfViewer .pageDown', // PDF阅读器常见
        'div[class*="arrow-right"]',
        'button[title="下一页"]',
        'button[title="Next"]'
    ];

    console.log(">>> V8.0 全能版已加载...");

    // ==========================================
    // MODULE 1: 底层伪装 (保持不变)
    // ==========================================
    try {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    } catch (e) {}
    
    // 音频上下文防休眠
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
    } catch(e) {}


    // ==========================================
    // MODULE 2: UI 面板 (保持不变)
    // ==========================================
    window.addEventListener('load', function() {
        let panel = document.createElement('div');
        panel.style.cssText = "position:fixed; top:50px; left:10px; background:rgba(0,0,0,0.85); color:white; padding:10px; z-index:999999; border-radius:8px; font-size:13px; font-family:sans-serif; border: 1px solid #444; min-width: 150px;";
        
        let statusText = document.createElement('div');
        statusText.innerText = "全能模式运行中...";
        statusText.style.cssText = "margin-bottom:8px; color:#2ecc71; font-weight:bold;";

        let toggleBtn = document.createElement('button');
        toggleBtn.innerText = "⏸ 暂停脚本";
        toggleBtn.style.cssText = "width:100%; padding:5px 0; cursor:pointer; background:#e74c3c; color:white; border:none; border-radius:4px; font-weight:bold;";
        
        toggleBtn.onclick = function() {
            isScriptRunning = !isScriptRunning;
            if (isScriptRunning) {
                toggleBtn.innerText = "⏸ 暂停脚本";
                toggleBtn.style.background = "#e74c3c";
                statusText.innerText = "全能模式运行中...";
                statusText.style.color = "#2ecc71";
            } else {
                toggleBtn.innerText = "▶ 恢复运行";
                toggleBtn.style.background = "#2ecc71";
                statusText.innerText = "脚本已暂停";
                statusText.style.color = "#f1c40f";
            }
        };

        let logArea = document.createElement('div');
        logArea.style.cssText = "margin-top:8px; font-size:11px; color:#aaa; border-top:1px solid #555; padding-top:5px;";
        logArea.innerText = "准备就绪...";

        panel.appendChild(statusText);
        panel.appendChild(toggleBtn);
        panel.appendChild(logArea);
        document.body.appendChild(panel);

        function updateLog(msg, color="#aaa") {
            if (!isScriptRunning) return;
            logArea.innerText = msg;
            logArea.style.color = color;
        }


        // ==========================================
        // MODULE 3: 核心逻辑循环 (新增 PPT 和 Word 逻辑)
        // ==========================================
        setInterval(() => {
            if (!isScriptRunning) return;

            // 1. 优先处理视频
            let video = findVideo();
            if (video) {
                handleVideo(video);
                return; // 如果在看视频，就不管别的
            }

            // 2. 其次处理 PPT (检测是否有页码如 29 / 34)
            if (handlePPT()) {
                return; // 如果在翻 PPT，也不管别的
            }

            // 3. 处理 Word/文档 (自动滚动)
            handleDocumentScroll();

            // 4. 最后尝试点击下一节
            findAndClickNext();

        }, CHECK_INTERVAL);


        // --- 功能函数：视频处理 ---
        function handleVideo(video) {
            if (!video.muted) video.muted = true;
            let isEnding = video.ended || (video.duration > 0 && video.currentTime >= video.duration - 0.5);

            if (isEnding) {
                updateLog("视频结束，准备跳转", "#f1c40f");
                setTimeout(findAndClickNext, 1000);
            } else if (video.paused) {
                updateLog("视频暂停，强制唤醒", "#e74c3c");
                video.play().catch(() => video.dispatchEvent(new MouseEvent("click")));
            } else {
                updateLog(`视频进度: ${(video.currentTime/video.duration*100).toFixed(1)}%`, "#2ecc71");
            }
        }

        // --- 功能函数：PPT 处理 (新增) ---
        function handlePPT() {
            // 策略：寻找网页中是否存在 "数字 / 数字" 这种格式的文本
            // 截图里是 "29 / 34"
            let pageCounter = null;
            let allDivs = document.querySelectorAll('div, span, p');
            
            for(let el of allDivs) {
                // 正则匹配： 数字 + 斜杠 + 数字
                let match = (el.innerText || "").match(/(\d+)\s*\/\s*(\d+)/);
                if (match) {
                    let current = parseInt(match[1]);
                    let total = parseInt(match[2]);
                    if (total > 0 && current <= total) {
                        pageCounter = { current, total, element: el };
                        break;
                    }
                }
            }

            if (pageCounter) {
                if (pageCounter.current < pageCounter.total) {
                    updateLog(`PPT翻页中: ${pageCounter.current} / ${pageCounter.total}`, "#3498db");
                    clickPPTNextButton();
                    return true; // 正在处理 PPT
                } else {
                    updateLog("PPT已看完", "#2ecc71");
                    // PPT 看完了，让主循环继续往下走，去点下一节
                    return false; 
                }
            }
            return false; // 没发现 PPT
        }

        function clickPPTNextButton() {
            // 尝试点击所有可能的“向右箭头”
            for (let selector of PPT_NEXT_SELECTORS) {
                let btns = document.querySelectorAll(selector);
                for (let btn of btns) {
                    if (btn.offsetParent !== null) { // 必须可见
                        triggerClick(btn);
                        return;
                    }
                }
            }
            
            // 备用方案：截图右下角有两个按钮，通常右边那个是下一页
            // 找所有 button，点屏幕位置最靠右下的那个
            /* 
               这个比较激进，暂时不启用，除非上面的 selector 都失效。
               如果有问题，请反馈，我再开启这个暴力模式。
            */
        }

        // --- 功能函数：文档滚动 (新增) ---
        function handleDocumentScroll() {
            // 1. 滚动主窗口
            let scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
            let clientHeight = document.documentElement.clientHeight || document.body.clientHeight;
            
            if (window.scrollY + clientHeight < scrollHeight - 50) {
                updateLog("正在阅读文档(滚动中)...", "#9b59b6"); // 紫色
                window.scrollTo(0, 999999); // 瞬间滚到底，简单粗暴
                // 也可以一点点滚：window.scrollBy(0, 500);
            }

            // 2. 滚动内部容器 (有些 Word 是嵌在一个 div 里的)
            let divs = document.querySelectorAll('div');
            for (let div of divs) {
                if (div.scrollHeight > div.clientHeight && div.clientHeight > 200) {
                    // 如果这个 div 有滚动条
                    if (div.scrollTop + div.clientHeight < div.scrollHeight - 10) {
                        div.scrollTop = div.scrollHeight;
                        // console.log("滚动了内部容器", div);
                    }
                }
            }
        }

        // --- 功能函数：查找视频 ---
        function findVideo(root = document) {
            let v = root.querySelector('video');
            if (v) return v;
            let all = root.querySelectorAll('*');
            for (let el of all) {
                if (el.shadowRoot) {
                    let sv = findVideo(el.shadowRoot);
                    if (sv) return sv;
                }
            }
            return null;
        }

        // --- 功能函数：点击下一节 ---
        function findAndClickNext() {
            for (let keyword of NEXT_KEYWORDS) {
                let xpath = `//*[text()[contains(.,'${keyword}')]]`;
                let result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                for (let i = 0; i < result.snapshotLength; i++) {
                    let el = result.snapshotItem(i);
                    if (el.offsetParent === null) continue;
                    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;

                    updateLog(`跳转下一节: [${el.innerText.trim()}]`, "#00ffff");
                    
                    el.removeAttribute('disabled');
                    let clickable = el;
                    // 向上找父级按钮
                    if (el.tagName !== 'BUTTON' && el.tagName !== 'A' && el.tagName !== 'INPUT') {
                         if (el.parentElement && (el.parentElement.tagName === 'BUTTON' || el.parentElement.className.includes('btn'))) {
                            clickable = el.parentElement;
                        }
                    }
                    triggerClick(clickable);
                    return; 
                }
            }
        }

        function triggerClick(el) {
            el.click();
            ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(eventType => {
                el.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true, view: window }));
            });
        }
    });
})();