let apiConfig;
let lastRequestTime = 0;
let currentAudioURL = null;
let requestCounter = 0;

const API_CONFIG = {
    'workers-api': {
        url: 'https://worker-tts.api.zwei.de.eu.org/tts'
    },
    'deno-api': {
        url: 'https://deno-tts.api.zwei.de.eu.org/tts'
    }
};

function loadSpeakers() {
    return $.ajax({
        url: 'speakers.json',
        method: 'GET',
        dataType: 'json',
        success: function(data) {
            apiConfig = data;
            updateSpeakerOptions('workers-api');
        },
        error: function(jqXHR, textStatus, errorThrown) {
            console.error(`加载讲述者失败：${textStatus} - ${errorThrown}`);
            showError('加载讲述者失败，请刷新页面重试。');
        }
    });
}

function updateSpeakerOptions(apiName) {
    const speakers = apiConfig[apiName].speakers;
    const speakerSelect = $('#speaker');
    speakerSelect.empty();
    
    Object.entries(speakers).forEach(([key, value]) => {
        speakerSelect.append(new Option(value, key));
    });
}

function updateSliderLabel(sliderId, labelId) {
    const slider = $(`#${sliderId}`);
    const label = $(`#${labelId}`);
    label.text(slider.val());
    
    slider.off('input').on('input', function() {
        label.text(this.value);
    });
}

$(document).ready(function() {
    loadSpeakers().then(() => {
        $('#apiTips').text('使用 Workers API，每天限制 100000 次请求');
        
        // 初始化音频播放器
        initializeAudioPlayer();
        
        $('[data-toggle="tooltip"]').tooltip();

        $('#api').on('change', function() {
            const apiName = $(this).val();
            updateSpeakerOptions(apiName);
            
            $('#rate, #pitch').val(0);
            updateSliderLabel('rate', 'rateValue');
            updateSliderLabel('pitch', 'pitchValue');
            
            const tips = {
                'workers-api': '使用 Workers API，每天限制 100000 次请求',
                'deno-api': '使用 Deno API，基于 Lobe-TTS，暂不支持语速语调调整'
            };
            $('#apiTips').text(tips[apiName] || '');
        });

        updateSliderLabel('rate', 'rateValue');
        updateSliderLabel('pitch', 'pitchValue');

        $('#generateButton').on('click', function() {
            if (canMakeRequest()) {
                generateVoice(false);
            } else {
                showError('请稍候再试，3秒只能请求一次。');
            }
        });

        $('#previewButton').on('click', function() {
            if (canMakeRequest()) {
                generateVoice(true);
            } else {
                showError('请稍候再试，每3秒只能请求一次。');
            }
        });

        $('#text').on('input', function() {
            const currentLength = $(this).val().length;
            $('#charCount').text(`最多50000个字符，目前已输入${currentLength}个字符；长文本将智能分段生成语音。`);
        });

        // 添加插入停顿功能
        $('#insertPause').on('click', function() {
            const seconds = parseFloat($('#pauseSeconds').val());
            if (isNaN(seconds) || seconds < 0.01 || seconds > 100) {
                showError('请输入0.01到100之间的数字');
                return;
            }
            
            const textarea = $('#text')[0];
            const cursorPos = textarea.selectionStart;
            const textBefore = textarea.value.substring(0, cursorPos);
            const textAfter = textarea.value.substring(textarea.selectionEnd);
            
            // 插入停顿标记
            const pauseTag = `<break time="${seconds}s"/>`;
            textarea.value = textBefore + pauseTag + textAfter;
            
            // 恢复光标位置
            const newPos = cursorPos + pauseTag.length;
            textarea.setSelectionRange(newPos, newPos);
            textarea.focus();
        });

        // 限制输入数字范围
        $('#pauseSeconds').on('input', function() {
            let value = parseFloat($(this).val());
            if (value > 100) $(this).val(100);
            if (value < 0.01 && value !== '') $(this).val(0.01);
        });
    });
});

function canMakeRequest() {
    const currentTime = Date.now();
    if (currentTime - lastRequestTime >= 3000) {
        lastRequestTime = currentTime;
        return true;
    }
    return false;
}

function generateVoice(isPreview) {
    const apiName = $('#api').val();
    const apiUrl = API_CONFIG[apiName].url;
    const text = $('#text').val().trim();
    
    if (!text) {
        showError('请输入要转换的文本');
        return;
    }

    if (isPreview) {
        const previewText = text.substring(0, 20);
        makeRequest(apiUrl, true, previewText, apiName === 'deno-api');
        return;
    }

    // 处理长文本
    const segments = splitText(text);
    if (segments.length > 1) {
        generateVoiceForLongText(segments).then(finalBlob => {
            if (finalBlob) {
                if (currentAudioURL) {
                    URL.revokeObjectURL(currentAudioURL);
                }
                currentAudioURL = URL.createObjectURL(finalBlob);
                $('#result').show();
                $('#audio').attr('src', currentAudioURL);
                $('#download').attr('href', currentAudioURL);
            }
        }).finally(() => {
            $('#generateButton').prop('disabled', false);
            $('#previewButton').prop('disabled', false);
        });
    } else {
        requestCounter++;
        const currentRequestId = requestCounter;
        makeRequest(apiUrl, false, text, apiName === 'deno-api', `#${currentRequestId}(1/1)`);
    }
}

const cachedAudio = new Map();

async function makeRequest(url, isPreview, text, isDenoApi, requestId = '') {
    try {
        const response = await fetch(url, { 
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                voice: $('#speaker').val(),
                rate: parseInt($('#rate').val()),
                pitch: parseInt($('#pitch').val()),
                preview: isPreview
            })
        });

        if (!response.ok) {
            throw new Error(`服务器响应错误: ${response.status}`);
        }

        const blob = await response.blob();
        
        // 验证返回的blob是否为有效的音频文件
        if (!blob.type.includes('audio/') || blob.size === 0) {
            throw new Error('无效的音频文件');
        }

        if (!isPreview) {
            currentAudioURL = URL.createObjectURL(blob);
            $('#result').show();
            $('#audio').attr('src', currentAudioURL);
            $('#download')
                .removeClass('disabled')
                .attr('href', currentAudioURL);
        }

        return blob;
    } catch (error) {
        console.error('请求错误:', error);
        throw error;
    }
}

function showError(message) {
    showMessage(message, 'danger');
}

function addHistoryItem(timestamp, speaker, text, audioBlob, requestInfo = '') {
    const MAX_HISTORY = 50;
    const historyItems = $('#historyItems');
    
    if (historyItems.children().length >= MAX_HISTORY) {
        const oldestItem = historyItems.children().last();
        oldestItem.remove();
    }

    const audioURL = URL.createObjectURL(audioBlob);
    cachedAudio.set(audioURL, audioBlob);
    
    const historyItem = $(`
        <div class="history-item list-group-item" style="opacity: 0;">
            <div class="d-flex justify-content-between align-items-center">
                <span class="text-truncate" style="max-width: 60%;">
                    <strong class="text-primary">${requestInfo}</strong> 
                    ${timestamp} - <span class="text-primary">${speaker}</span> - ${text}
                </span>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-primary play-btn" data-url="${audioURL}">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-success" onclick="downloadAudio('${audioURL}')">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
        </div>
    `);
    
    // 添加整个条目的点击事件
    historyItem.on('click', function(e) {
        // 如果点击的是按钮，不触发条目的点击事件
        if (!$(e.target).closest('.btn-group').length) {
            playAudio(audioURL);
            // 更新预览区
            if (currentAudioURL) {
                URL.revokeObjectURL(currentAudioURL);
            }
            currentAudioURL = URL.createObjectURL(cachedAudio.get(audioURL));
            $('#result').show();
            $('#audio').attr('src', currentAudioURL);
            $('#download')
                .removeClass('disabled')
                .attr('href', currentAudioURL);
        }
    });
    
    // 在条目被移除时清理资源
    historyItem.on('remove', () => {
        URL.revokeObjectURL(audioURL);
        cachedAudio.delete(audioURL);
    });
    
    historyItem.find('.play-btn').on('click', function(e) {
        e.stopPropagation();  // 阻止事件冒泡
        playAudio($(this).data('url'));
    });
    
    $('#historyItems').prepend(historyItem);
    setTimeout(() => historyItem.animate({ opacity: 1 }, 300), 50);
}

function playAudio(audioURL) {
    const audioElement = $('#audio')[0];
    const allPlayButtons = $('.play-btn');
    
    // 如果点击的是当前正在播放的音频
    if (audioElement.src === audioURL && !audioElement.paused) {
        audioElement.pause();
        allPlayButtons.each(function() {
            if ($(this).data('url') === audioURL) {
                $(this).html('<i class="fas fa-play"></i>');
            }
        });
        return;
    }
    
    // 重置所有按钮标
    allPlayButtons.html('<i class="fas fa-play"></i>');
    
    // 设置新的音频源并播放
    audioElement.src = audioURL;
    audioElement.load();
    
    // 只在实际播放时才设置错误处理
    audioElement.play().then(() => {
        // 更新当前播放按钮图标
        allPlayButtons.each(function() {
            if ($(this).data('url') === audioURL) {
                $(this).html('<i class="fas fa-pause"></i>');
            }
        });
    }).catch(error => {
        if (error.name !== 'AbortError') {  // 忽略中止错误
            console.error('播放失败:', error);
            showError('音频播放失败，请重试');
        }
    });
    
    // 监听播放结束事件
    audioElement.onended = function() {
        allPlayButtons.each(function() {
            if ($(this).data('url') === audioURL) {
                $(this).html('<i class="fas fa-play"></i>');
            }
        });
    };
}

function downloadAudio(audioURL) {
    const blob = cachedAudio.get(audioURL);
    if (blob) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'audio.mp3';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }
}

function clearHistory() {
    $('#historyItems .history-item').each(function() {
        $(this).remove();
    });
    
    // 清理所有缓存的音频
    cachedAudio.forEach((blob, url) => {
        URL.revokeObjectURL(url);
    });
    cachedAudio.clear();
    
    $('#historyItems').empty();
    alert("历史记录已清除！");
}

function initializeAudioPlayer() {
    const audio = document.getElementById('audio');
    audio.style.borderRadius = '12px';
    audio.style.width = '100%';
    audio.style.marginTop = '20px';
    
    // 初始状态设置
    $('#download')
        .addClass('disabled')
        .attr('href', '#');
    $('#audio').attr('src', '');
}

function showMessage(message, type = 'danger') {
    const toast = $(`
        <div class="toast">
            <div class="toast-body toast-${type}">
                ${message}
            </div>
        </div>
    `);
    
    $('.toast-container').append(toast);
    
    // 显示动画
    setTimeout(() => {
        toast.addClass('show');
    }, 100);
    
    // 3秒后淡出并移除
    setTimeout(() => {
        toast.removeClass('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// 添加句子结束符号的正则表达式
const SENTENCE_ENDINGS = /[.。！？!?]/;
const PARAGRAPH_ENDINGS = /[\n\r]/;

function getTextLength(str) {
    // 移除 XML 标签，但记录停顿时间
    let totalPauseTime = 0;
    const textWithoutTags = str.replace(/<break\s+time="(\d+(?:\.\d+)?)(m?s)"\s*\/>/g, (match, time, unit) => {
        const seconds = unit === 'ms' ? parseFloat(time) / 1000 : parseFloat(time);
        totalPauseTime += seconds;
        return '';
    });

    // 计算文本长度（中文2字符，英文1字符）
    const textLength = textWithoutTags.split('').reduce((acc, char) => {
        return acc + (char.charCodeAt(0) > 127 ? 2 : 1);
    }, 0);

    // 将停顿时间转换为等效字符长度（1秒 = 11个单位，相当于5.5个中文字符）
    const pauseLength = Math.round(totalPauseTime * 11);

    return textLength + pauseLength;
}

function splitText(text, maxLength = 5000) {
    const segments = [];
    let remainingText = text.trim();

    while (remainingText.length > 0) {
        if (getTextLength(remainingText) <= maxLength) {
            segments.push(remainingText);
            break;
        }

        // 基本标点符号
        const punctuationMarks = [
            '。', '！', '？', '；', '…', '，',  // 中文标点
            '.', '!', '?', ';', ',',           // 英文标点
            '\n', '\r\n'                       // 换行符
        ];

        // 括号配对
        const bracketPairs = {
            '（': '）', 
            '(': ')',
            '【': '】',
            '[': ']',
            '{': '}',
            '"': '"',
            "'": "'",
            '「': '���',
            '『': '』'
        };

        let splitIndex = remainingText.length;
        let currentLength = 0;
        let lastPunctuationIndex = -1;
        let inTag = false;
        let bracketStack = [];

        for (let i = 0; i < remainingText.length; i++) {
            // 跳过 XML 标签内容
            if (remainingText[i] === '<') {
                inTag = true;
                continue;
            }
            if (remainingText[i] === '>') {
                inTag = false;
                continue;
            }
            if (inTag) continue;

            // 处理括号配对
            if (bracketPairs[remainingText[i]]) {
                bracketStack.push({
                    char: remainingText[i],
                    index: i
                });
            } else if (Object.values(bracketPairs).includes(remainingText[i])) {
                if (bracketStack.length > 0) {
                    bracketStack.pop();
                }
            }

            // 记录标点符号位置（���在括号内时）
            if (punctuationMarks.includes(remainingText[i]) && bracketStack.length === 0) {
                lastPunctuationIndex = i;
            }

            currentLength += remainingText.charCodeAt(i) > 127 ? 2 : 1;
            if (currentLength > maxLength) {
                splitIndex = i;
                break;
            }
        }

        // 优先在标点处分段
        if (lastPunctuationIndex > 0 && lastPunctuationIndex > splitIndex - 50) {
            splitIndex = lastPunctuationIndex + 1;
        }

        segments.push(remainingText.substring(0, splitIndex));
        remainingText = remainingText.substring(splitIndex).trim();
    }

    return segments;
}

function showLoading(message) {
    let loadingToast = $('.toast-loading');
    if (loadingToast.length) {
        // 如果已存在 loading toast，只更新进度条，不更新消息
        loadingToast.find('.progress-bar').css('width', '0%');
        return;
    }

    // 创建新的loading提示
    const toast = $(`
        <div class="toast toast-loading">
            <div class="toast-body toast-info">
                <div class="text-center">
                    <i class="fas fa-spinner fa-spin"></i>
                    <div class="loading-message mt-2">${message}</div>
                    <div class="progress mt-2">
                        <div class="progress-bar" role="progressbar" style="width: 0%"></div>
                    </div>
                </div>
            </div>
        </div>
    `);
    
    $('.toast-container').append(toast);
    setTimeout(() => toast.addClass('show'), 100);
}

function hideLoading() {
    const loadingToast = $('.toast-loading');
    loadingToast.removeClass('show');
    setTimeout(() => loadingToast.remove(), 300);
}

function updateLoadingProgress(progress, message) {
    const loadingToast = $('.toast-loading');
    if (loadingToast.length) {
        loadingToast.find('.progress-bar').css('width', `${progress}%`);
        loadingToast.find('.loading-message').text(message);
    }
}

async function generateVoiceForLongText(segments) {
    const results = [];
    const apiName = $('#api').val();
    const apiUrl = API_CONFIG[apiName].url;
    const totalSegments = segments.length;
    requestCounter++;
    const currentRequestId = requestCounter;
    
    // 获取原始文本的前几个字符用于显示
    const originalText = $('#text').val();
    const shortenedText = originalText.length > 7 ? originalText.substring(0, 7) + '...' : originalText;
    
    showLoading('');
    
    let hasSuccessfulSegment = false;
    const MAX_RETRIES = 3;

    for (let i = 0; i < segments.length; i++) {
        let retryCount = 0;
        let success = false;
        let lastError = null;

        while (retryCount < MAX_RETRIES && !success) {
            try {
                const progress = ((i + 1) / totalSegments * 100).toFixed(1);
                const retryInfo = retryCount > 0 ? `(重试 ${retryCount}/${MAX_RETRIES})` : '';
                updateLoadingProgress(progress, `正在生成第 ${i + 1}/${totalSegments} 段语音${retryInfo}...`);
                
                const blob = await makeRequest(
                    apiUrl, 
                    false, 
                    segments[i], 
                    apiName === 'deno-api', 
                    `#${currentRequestId}(${i + 1}/${totalSegments})`
                );
                
                if (blob) {
                    hasSuccessfulSegment = true;
                    success = true;
                    results.push(blob);
                    const timestamp = new Date().toLocaleTimeString();
                    const speaker = $('#speaker option:selected').text();
                    const segmentText = segments[i].length > 7 ? segments[i].substring(0, 7) + '...' : segments[i];
                    const requestInfo = `#${currentRequestId}(${i + 1}/${totalSegments})`;
                    addHistoryItem(timestamp, speaker, segmentText, blob, requestInfo);
                }
            } catch (error) {
                lastError = error;
                retryCount++;
                
                if (retryCount < MAX_RETRIES) {
                    console.error(`分段 ${i + 1} 生成失败 (重试 ${retryCount}/${MAX_RETRIES}):`, error);
                    const waitTime = 3000 + (retryCount * 2000);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    showError(`第 ${i + 1}/${totalSegments} 段生成失败：${error.message}`);
                }
            }
        }

        if (!success) {
            console.error(`分段 ${i + 1} 在 ${MAX_RETRIES} 次尝试后仍然失败:`, lastError);
        }

        if (success && i < segments.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    hideLoading();

    if (results.length > 0) {
        const finalBlob = new Blob(results, { type: 'audio/mpeg' });
        const timestamp = new Date().toLocaleTimeString();
        const speaker = $('#speaker option:selected').text();
        // 添加合并标记
        const mergeRequestInfo = `#${currentRequestId}(合并)`;
        addHistoryItem(timestamp, speaker, shortenedText, finalBlob, mergeRequestInfo);
        return finalBlob;
    }

    throw new Error('所有片段生成失败');
}

// 在 body 末尾添加 toast 容器
$('body').append('<div class="toast-container"></div>');

// 可以添加其他类型的消息提示
function showWarning(message) {
    showMessage(message, 'warning');
}

function showInfo(message) {
    showMessage(message, 'info');
}