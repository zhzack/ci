#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 module_affinity.json 生成核心负载分布柱状图 HTML（含分类/核心下钻）
使用方法: python get_affinity_html.py
"""

import argparse
import json
import sys
from pathlib import Path


def parse_affinity_to_cores(aff):
    """将 cpu_affinity 值解析为 CPU 核心列表"""
    if aff is None:
        return []
    if isinstance(aff, int):
        return [aff]
    s = str(aff).strip()
    if not s:
        return []
    if '-' in s:
        parts = s.split('-')
        try:
            start, end = int(parts[0]), int(parts[1])
            if start <= end:
                return list(range(start, end + 1))
        except (ValueError, IndexError):
            pass
    try:
        return [int(s)]
    except ValueError:
        return []


def detect_platform_from_files(files):
    """
    从 m_package_files 中检测平台类型
    返回: 平台标识字符串, 或 None
    """
    if not files:
        return None

    for file_name in files:
        if not isinstance(file_name, str):
            continue
        file_lower = file_name.lower()
        # 检测 DJINS -> CSUVL3_main
        if 'djins' in file_lower:
            return 'CSUVL3_main'
        # 检测 thorU
        if 'thoru' in file_lower:
            return 'thorU'
        # 检测 orinX
        if 'orin' in file_lower:
            return 'orinX'
    return None


def build_flat_platforms(raw_json):
    """
    从原始 JSON 构建扁平化的平台数据
    只保留与 m_package_files 匹配的平台
    返回: (platforms_dict, cats_list, cores_list, plat_names_list, target_platform)
    """
    m_package_files = raw_json.get('m_package_files', []) if isinstance(raw_json, dict) else []
    target_platform = detect_platform_from_files(m_package_files)

    platforms = {}
    all_cats = set()
    all_cores = set()

    for platform_name, platform_data in raw_json.items():
        if platform_name.startswith("_") or platform_name in {"metadata", "m_package_files"}:
            continue

        # 如果有目标平台，只保留匹配的平台
        if target_platform and platform_name != target_platform:
            continue

        if isinstance(platform_data, dict) and "module_affinity" in platform_data:
            module_entries = platform_data.get("module_affinity", {})
        else:
            module_entries = platform_data if isinstance(platform_data, dict) else {}

        modules = []
        for mod_name, info in module_entries.items():
            if not isinstance(info, dict):
                continue
            cat = info.get("category", "未分类")
            aff = info.get("cpu_affinity")
            prio = info.get("priority")
            cores = parse_affinity_to_cores(aff)

            all_cats.add(cat)
            for c in cores:
                all_cores.add(c)

            modules.append({
                "name": mod_name,
                "cpu_affinity": aff,
                "cpu_cores": cores,
                "priority": prio,
                "category": cat
            })

        platforms[platform_name] = modules

    cats_list = sorted(all_cats, key=lambda x: (
        0 if x == '适配器模块' else
        1 if x == 'HMI 模块' else
        2 if x == 'IM 模块' else
        3 if x == 'MFF 模块' else
        4 if x == '感知/传感器模块' else
        5 if x == '控制/核心模块' else
        6 if x == '服务/系统模块' else
        7 if x == '融合/映射模块' else
        8 if x == '规划模块' else
        9 if x == '其他模块' else
        10 if x == '未分类' else 99
    ))
    cores_list = sorted(all_cores)
    plat_names_list = list(platforms.keys())

    return platforms, cats_list, cores_list, plat_names_list, target_platform


def extract_v_suffix_from_m_package_files(raw_data: dict) -> str:
    files = raw_data.get('m_package_files', []) if isinstance(raw_data, dict) else []
    for file_name in files:
        if not isinstance(file_name, str):
            continue
        idx = file_name.rfind('.tgz')
        if idx == -1:
            continue
        v_idx = file_name.rfind('V', 0, idx)
        if v_idx != -1:
            return file_name[v_idx:idx]
    return ''


def format_m_package_files(raw_data: dict) -> str:
    files = raw_data.get('m_package_files', []) if isinstance(raw_data, dict) else []
    if not files:
        return ''
    lines = ''.join(f'<div>{file_name}</div>' for file_name in files if isinstance(file_name, str))
    return f'<strong>M 包文件:</strong>{lines}'


def generate_html(input_json_path, output_html_path):
    with open(input_json_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)

    flat_platforms, cats, cores, plat_names, target_platform = build_flat_platforms(raw_data)

    platforms_json_str = json.dumps(flat_platforms, ensure_ascii=False)
    cats_json_str = json.dumps(cats, ensure_ascii=False)
    cores_json_str = json.dumps(cores, ensure_ascii=False)
    plat_names_json_str = json.dumps(plat_names, ensure_ascii=False)
    target_platform_json_str = json.dumps(target_platform, ensure_ascii=False)

    m_package_html = format_m_package_files(raw_data)

    # 防止 JSON 中出现 </script> 导致 HTML 提前结束
    platforms_json_str = platforms_json_str.replace('</script>', '<\/script>')

    final_html = HTML_TEMPLATE.replace("__PLATFORMS_DATA_PLACEHOLDER__", platforms_json_str)
    final_html = final_html.replace("__CATS_DATA_PLACEHOLDER__", cats_json_str)
    final_html = final_html.replace("__CORES_DATA_PLACEHOLDER__", cores_json_str)
    final_html = final_html.replace("__PLAT_NAMES_DATA_PLACEHOLDER__", plat_names_json_str)
    final_html = final_html.replace("__TARGET_PLATFORM_PLACEHOLDER__", target_platform_json_str)
    final_html = final_html.replace("__M_PACKAGE_FILES_PLACEHOLDER__", m_package_html)

    with open(output_html_path, 'w', encoding='utf-8') as f:
        f.write(final_html)
    print(f"✅ HTML 生成成功: {output_html_path}")
    if plat_names:
        print(f"📌 显示平台: {', '.join(plat_names)}")
    else:
        print("⚠️ 警告: 未找到匹配的平台数据")


# ============================================================
# HTML 模板：核心负载分布柱状图 + 分类下钻 + 核心下钻 + 模块搜索定位
# ============================================================
HTML_TEMPLATE = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>核心负载分布柱状图 + 分类/核心下钻</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #f0f2f5; font-family: 'Segoe UI', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif; padding: 1.5rem; color: #1a2c3e; }
        .header { max-width: 1400px; margin: 0 auto 1.2rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }
        .header h1 { font-size: 1.5rem; font-weight: 700; color: #0f2f3f; }
        .header .badge { background: white; padding: 0.4rem 1rem; border-radius: 30px; font-size: 0.8rem; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
        .controls { max-width: 1400px; margin: 0 auto 1rem; background: white; border-radius: 16px; padding: 0.8rem 1.2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
        .ctrl-row { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; margin-bottom: 0.6rem; }
        .ctrl-row:last-child { margin-bottom: 0; }
        .controls select, .controls input[type="text"] { padding: 0.4rem 0.8rem; border-radius: 8px; border: 1px solid #d0d7de; font-size: 0.8rem; outline: none; }
        .controls label { font-size: 0.8rem; font-weight: 600; color: #555; }
        .cat-filter { display: flex; flex-wrap: wrap; gap: 0.6rem 1.2rem; align-items: center; }
        .cat-item { display: inline-flex; align-items: center; gap: 4px; font-size: 0.8rem; cursor: pointer; user-select: none; }
        .cat-item input { cursor: pointer; }
        .btn { padding: 0.35rem 0.9rem; border-radius: 6px; border: 1px solid #d0d7de; background: #f6f8fa; font-size: 0.78rem; cursor: pointer; transition: 0.15s; }
        .btn:hover { background: #eef1f5; }
        .btn-primary { background: #2c8eb3; color: white; border-color: #2c8eb3; }
        .btn-primary:hover { background: #237a9a; }
        .chart-container { max-width: 1400px; margin: 0 auto; background: white; border-radius: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); padding: 1rem; }
        .chart { width: 100%; height: 520px; }
        .detail-panel { max-width: 1400px; margin: 1rem auto 0; background: white; border-radius: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); padding: 1rem; display: none; }
        .detail-panel.show { display: block; }
        .detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
        .detail-header h3 { font-size: 1.1rem; color: #0f2f3f; }
        .detail-chart { width: 100%; height: 600px; }
        .prio-legend { display: flex; gap: 1rem; font-size: 0.78rem; align-items: center; flex-wrap: wrap; }
        .prio-legend-item { display: inline-flex; align-items: center; gap: 4px; }
        .prio-legend-dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
        .hint { font-size: 0.75rem; color: #888; margin-top: 0.4rem; }
        .m-package-files { max-width: 1400px; margin: 0 auto 1rem; padding: 0.85rem 1rem; background: white; border: 1px solid #e6ebf2; border-radius: 12px; color: #333; font-size: 0.95rem; line-height: 1.6; }
        .m-package-files strong { color: #0f2f3f; margin-right: 0.3rem; }
        .footer { max-width: 1400px; margin: 1.2rem auto; text-align: center; color: #999; font-size: 0.75rem; }
    </style>
</head>
<body>
<div class="header">
    <h1>核心负载分布柱状图 + 分类/核心下钻</h1>
    <div class="badge" id="statBadge">加载中...</div>
</div>
<div class="m-package-files">__M_PACKAGE_FILES_PLACEHOLDER__</div>

<div class="controls">
    <div class="ctrl-row">
        <label>平台:</label>
        <select id="platSelect" onchange="renderChart()">
        </select>
        <label>模式:</label>
        <select id="modeSelect" onchange="renderChart()">
            <option value="grouped">分组柱状图</option>
            <option value="stacked">堆叠柱状图</option>
        </select>
        <label>按分类堆叠:</label>
        <select id="stackSelect" onchange="renderChart()">
            <option value="category">按分类</option>
            <option value="priority">按优先级</option>
        </select>
        <span class="hint" style="margin-left:auto;">点击柱子 → 分类详情 | 点击CPU标签/空白处 → 核心模块分布</span>
    </div>
    <div class="ctrl-row">
        <label>分类过滤:</label>
        <div class="cat-filter" id="catFilter"></div>
        <div style="display:flex;gap:0.5rem;">
            <button class="btn" onclick="selectAllCats(true)">全选</button>
            <button class="btn" onclick="invertCats()">反选</button>
            <button class="btn" onclick="selectAllCats(false)">清空</button>
        </div>
    </div>
    <!-- 模块搜索定位行 -->
    <div class="ctrl-row">
        <label>🔍 模块搜索:</label>
        <input type="text" id="moduleSearchInput" placeholder="输入模块名（支持模糊匹配）..." style="width:240px;" onkeydown="if(event.key==='Enter'){searchModule();}">
        <button class="btn btn-primary" onclick="searchModule()">搜索</button>
        <button class="btn" onclick="clearSearch()">清除</button>
        <span class="hint" id="searchResultInfo" style="margin-left:0.5rem;"></span>
    </div>
</div>

<div class="chart-container">
    <div id="chart" class="chart"></div>
</div>

<div class="detail-panel" id="detailPanel">
    <div class="detail-header">
        <div>
            <h3 id="detailTitle">分类详情</h3>
            <div class="prio-legend" id="prioLegend" style="margin-top:6px;"></div>
        </div>
        <div style="display:flex;gap:0.6rem;align-items:center;">
            <label class="cat-item" style="font-size:0.8rem;">
                <input type="checkbox" id="dedupCheck" checked onchange="refreshDetail()">
                <span>跨平台去重</span>
            </label>
            <input type="text" id="detailSearch" placeholder="搜索模块名..." oninput="refreshDetail()" style="padding:0.35rem 0.7rem;border-radius:6px;border:1px solid #d0d7de;font-size:0.8rem;width:160px;">
            <button class="btn" onclick="closeDetail()">关闭详情</button>
        </div>
    </div>
    <div id="detailChart" class="detail-chart"></div>
</div>

<div class="detail-panel" id="coreDetailPanel">
    <div class="detail-header">
        <div>
            <h3 id="coreDetailTitle">核心详情</h3>
            <div class="prio-legend" id="corePrioLegend" style="margin-top:6px;"></div>
        </div>
        <div style="display:flex;gap:0.6rem;align-items:center;">
            <label class="cat-item" style="font-size:0.8rem;">
                <input type="checkbox" id="coreDedupCheck" checked onchange="refreshCoreDetail()">
                <span>跨平台去重</span>
            </label>
            <input type="text" id="coreDetailSearch" placeholder="搜索模块名..." oninput="refreshCoreDetail()" style="padding:0.35rem 0.7rem;border-radius:6px;border:1px solid #d0d7de;font-size:0.8rem;width:160px;">
            <button class="btn" onclick="closeCoreDetail()">关闭详情</button>
        </div>
    </div>
    <div id="coreDetailChart" class="detail-chart"></div>
</div>

<div class="footer">智驾绑核可视化 | 核心负载分布柱状图</div>

<script>
// ======================== 嵌入的数据（由 Python 脚本生成） ========================
const PLATFORMS = __PLATFORMS_DATA_PLACEHOLDER__;
const CATS = __CATS_DATA_PLACEHOLDER__;
const CORES = __CORES_DATA_PLACEHOLDER__;
const PLAT_NAMES = __PLAT_NAMES_DATA_PLACEHOLDER__;
const TARGET_PLATFORM = __TARGET_PLATFORM_PLACEHOLDER__;

// 分类颜色映射
const CAT_COLORS = {
    '适配器模块': '#5470c6', 'HMI 模块': '#91cc75', '控制/核心模块': '#fac858',
    '规划模块': '#ee6666', '服务/系统模块': '#73c0de', '感知/传感器模块': '#3ba272',
    'IM 模块': '#fc8452', '融合/映射模块': '#9a60b4', 'MFF 模块': '#ea7ccc',
    '其他模块': '#a0a0a0', '未分类': '#c0c0c0'
};
const PRIO_COLORS = {'极高': '#c44545', '高': '#e28743', '中': '#f0a34b', '低': '#5fa7cf', '未配置': '#a0b8ce'};

let selectedCats = new Set(CATS);
let mainChart = null;
let detailChart = null;
let coreDetailChart = null;
let currentDetailCat = '';
let currentDetailPlat = '';
let currentDetailCore = null;
let _clickSeq = 0;
let _zrClickHandler = null;

// 模块搜索状态
let searchState = { query: '', matchedModules: [], coreIndices: [], coreMatchMap: {} };

function modHasCore(m, core) { return (m.cpu_cores || []).indexOf(core) >= 0; }

function getPrioLevel(prio) {
    if (prio === null || prio === undefined) return '未配置';
    if (prio <= 2) return '极高';
    if (prio <= 5) return '高';
    if (prio <= 10) return '中';
    return '低';
}

function renderCatFilter() {
    const container = document.getElementById('catFilter');
    container.innerHTML = '';
    CATS.forEach(cat => {
        const label = document.createElement('label');
        label.className = 'cat-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedCats.has(cat);
        cb.dataset.cat = cat;
        cb.onchange = () => {
            if (cb.checked) selectedCats.add(cat); else selectedCats.delete(cat);
            renderChart();
        };
        const span = document.createElement('span');
        span.textContent = cat;
        span.style.color = CAT_COLORS[cat] || '#555';
        span.style.fontWeight = '600';
        label.appendChild(cb);
        label.appendChild(span);
        container.appendChild(label);
    });
}

function selectAllCats(val) {
    if (val) CATS.forEach(c => selectedCats.add(c));
    else selectedCats.clear();
    document.querySelectorAll('#catFilter input').forEach(cb => cb.checked = val);
    renderChart();
}

function invertCats() {
    CATS.forEach(c => {
        if (selectedCats.has(c)) selectedCats.delete(c); else selectedCats.add(c);
    });
    document.querySelectorAll('#catFilter input').forEach(cb => {
        cb.checked = selectedCats.has(cb.dataset.cat);
    });
    renderChart();
}

function buildData(platform, stackBy) {
    const targets = [platform];
    const series = [];
    const activeCats = CATS.filter(c => selectedCats.has(c));
    if (stackBy === 'category') {
        for (const cat of activeCats) {
            const data = CORES.map(c => {
                let count = 0;
                for (const p of targets) {
                    for (const m of (PLATFORMS[p] || [])) {
                        if (modHasCore(m, c) && m.category === cat) count++;
                    }
                }
                return count;
            });
            series.push({ name: cat, type: 'bar', data, itemStyle: { color: CAT_COLORS[cat] || '#999' }, emphasis: { focus: 'series' } });
        }
    } else {
        const keys = ['极高', '高', '中', '低', '未配置'];
        for (const lvl of keys) {
            const data = CORES.map(c => {
                let count = 0;
                for (const p of targets) {
                    for (const m of (PLATFORMS[p] || [])) {
                        if (modHasCore(m, c) && getPrioLevel(m.priority) === lvl && selectedCats.has(m.category)) count++;
                    }
                }
                return count;
            });
            series.push({ name: lvl, type: 'bar', data, itemStyle: { color: PRIO_COLORS[lvl] || '#999' }, emphasis: { focus: 'series' } });
        }
    }
    return series;
}

function renderChart() {
    const plat = document.getElementById('platSelect').value;
    const mode = document.getElementById('modeSelect').value;
    const stackBy = document.getElementById('stackSelect').value;
    if (!mainChart) mainChart = echarts.init(document.getElementById('chart'));
    const series = buildData(plat, stackBy);
    for (const s of series) s.stack = (mode === 'stacked') ? 'total' : undefined;

    let total = 0;
    const targets = [plat];

    // 若详情面板已展开，配置切换时自动关联更新
    if (currentDetailCat) {
        currentDetailPlat = plat;
        _doRenderDetail(false);
    }
    if (currentDetailCore !== null) {
        currentDetailPlat = plat;
        _doRenderCoreDetail(false);
    }
    for (const p of targets) {
        for (const m of (PLATFORMS[p] || [])) {
            if (selectedCats.has(m.category)) total += (m.cpu_cores || []).length;
        }
    }
    document.getElementById('statBadge').innerHTML = '模块实例: ' + total + ' | 平台: ' + plat;

    mainChart.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { show: false },
        grid: { left: 50, right: 30, top: 20, bottom: 40 },
        xAxis: { type: 'category', data: CORES.map(c => 'CPU ' + c), name: 'CPU 核心', triggerEvent: true },
        yAxis: { type: 'value', name: '模块数量', minInterval: 1 },
        series: series
    }, true);

    // 模块搜索标记（用 markArea 填充所在核背景 + 顶部标注匹配模块名）
    if (searchState.query && searchState.coreIndices.length > 0) {
        const markAreaData = searchState.coreIndices.map(idx => [
            { xAxis: 'CPU ' + CORES[idx] },
            { xAxis: 'CPU ' + CORES[idx] }
        ]);
        const markPointData = searchState.coreIndices.map(idx => {
            const names = searchState.coreMatchMap[idx] || [];
            const labelText = names.length <= 2 ? names.join('\n') : (names.slice(0, 2).join('\n') + '\n+' + (names.length - 2));
            return {
                coord: [idx, 0],
                symbol: 'circle',
                symbolSize: 1,
                itemStyle: { color: 'transparent' },
                label: {
                    show: true,
                    formatter: labelText,
                    fontSize: 11,
                    fontWeight: 'bold',
                    color: '#c44545',
                    backgroundColor: 'rgba(255,255,255,0.92)',
                    borderColor: 'rgba(196,69,69,0.5)',
                    borderWidth: 1,
                    borderRadius: 4,
                    padding: [3, 6],
                    position: 'top',
                    lineHeight: 14
                }
            };
        });
        const markSeries = [];
        for (let i = 0; i < series.length; i++) {
            markSeries.push({
                markArea: i === 0 ? {
                    silent: true,
                    data: markAreaData,
                    itemStyle: { color: 'rgba(196,69,69,0.16)', borderColor: 'rgba(196,69,69,0.45)', borderWidth: 1 },
                    label: { show: false }
                } : undefined,
                markPoint: i === 0 ? { data: markPointData, animation: true } : undefined
            });
        }
        mainChart.setOption({ series: markSeries });
    }

    // 分类下钻 / 核心下钻事件
    _clickSeq = 0;
    mainChart.off('click');
    mainChart.on('click', function(params) {
        _clickSeq++;
        if (params.componentType === 'series' && CATS.includes(params.seriesName)) {
            renderDetail(params.seriesName, plat);
        } else if (params.componentType === 'xAxis') {
            const ci = params.dataIndex;
            if (ci >= 0 && ci < CORES.length) {
                renderCoreDetail(CORES[ci], plat);
            }
        }
    });

    if (_zrClickHandler) {
        mainChart.getZr().off('click', _zrClickHandler);
    }
    _zrClickHandler = function(zrEvent) {
        const mySeq = _clickSeq;
        const ex = zrEvent.offsetX, ey = zrEvent.offsetY;
        setTimeout(function() {
            if (_clickSeq !== mySeq) return;
            if (mainChart.containPixel('grid', [ex, ey])) {
                const point = mainChart.convertFromPixel('grid', [ex, ey]);
                const coreIndex = Math.round(point[0]);
                if (coreIndex >= 0 && coreIndex < CORES.length) {
                    renderCoreDetail(CORES[coreIndex], plat);
                }
                return;
            }
            const gridModel = mainChart.getModel().getComponent('grid', 0);
            if (gridModel && gridModel.coordinateSystem) {
                const gr = gridModel.coordinateSystem.getRect();
                if (ey >= gr.y + gr.height && ey < gr.y + gr.height + 45 &&
                    ex >= gr.x && ex <= gr.x + gr.width) {
                    const pt = mainChart.convertFromPixel('grid', [ex, gr.y + gr.height - 1]);
                    const ci = Math.round(pt[0]);
                    if (ci >= 0 && ci < CORES.length) {
                        renderCoreDetail(CORES[ci], plat);
                    }
                }
            }
        }, 0);
    };
    mainChart.getZr().on('click', _zrClickHandler);
}

// ==================== 模块搜索与定位 ====================
function searchModule() {
    const query = document.getElementById('moduleSearchInput').value.trim();
    if (!query) return;
    const plat = document.getElementById('platSelect').value;
    const qLower = query.toLowerCase();
    const matchedModules = [];
    const coreSet = new Set();
    const coreMatchMap = {};
    const targets = [plat];
    for (const p of targets) {
        for (const m of (PLATFORMS[p] || [])) {
            // 模糊匹配（不区分大小写），收集所有结果
            if (m.name.toLowerCase().indexOf(qLower) >= 0) {
                matchedModules.push(m);
                for (const c of (m.cpu_cores || [])) {
                    const idx = CORES.indexOf(c);
                    if (idx >= 0) {
                        coreSet.add(idx);
                        if (!coreMatchMap[idx]) coreMatchMap[idx] = [];
                        if (coreMatchMap[idx].indexOf(m.name) < 0) coreMatchMap[idx].push(m.name);
                    }
                }
            }
        }
    }
    if (matchedModules.length === 0) {
        alert('未找到匹配模块: ' + query);
        clearSearch();
        return;
    }
    const coreIndices = Array.from(coreSet).sort((a, b) => a - b);
    // 更新搜索状态并重绘图表
    searchState.query = query;
    searchState.matchedModules = matchedModules;
    searchState.coreIndices = coreIndices;
    searchState.coreMatchMap = coreMatchMap;
    // 显示匹配结果信息（所有结果）
    const modNames = matchedModules.map(m => m.name);
    const displayNames = modNames.length > 6 ? modNames.slice(0, 6).join('、') + ' 等' : modNames.join('、');
    document.getElementById('searchResultInfo').innerHTML =
        '匹配 <b style="color:#c44545;">' + matchedModules.length + '</b> 个模块（' + displayNames +
        '），高亮 <b style="color:#c44545;">' + coreIndices.length + '</b> 个核心';
    renderChart();
    // 自动滚动到主图
    document.querySelector('.chart-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearSearch() {
    document.getElementById('moduleSearchInput').value = '';
    document.getElementById('searchResultInfo').innerHTML = '';
    searchState.query = '';
    searchState.matchedModules = [];
    searchState.coreIndices = [];
    searchState.coreMatchMap = {};
    renderChart();
}

// ==================== 详细面板逻辑保持不变 ====================
function renderDetail(catName, plat) {
    currentDetailCat = catName;
    currentDetailPlat = plat;
    _doRenderDetail();
}

function refreshDetail() {
    if (currentDetailCat) _doRenderDetail(false);
}

function _doRenderDetail(shouldScroll) {
    if (shouldScroll === undefined) shouldScroll = true;
    const catName = currentDetailCat;
    const plat = currentDetailPlat;
    const panel = document.getElementById('detailPanel');
    panel.classList.add('show');
    document.getElementById('detailTitle').innerHTML = '\u300C' + catName + '\u300D核心-优先级分布';
    if (!detailChart) detailChart = echarts.init(document.getElementById('detailChart'));

    const levelColor = {
        '极高': '#c44545', '高': '#e28743', '中': '#f0a34b',
        '低': '#5fa7cf', '未配置': '#a0b8ce'
    };
    const levelOrder = ['极高', '高', '中', '低', '未配置'];
    let legendHtml = '<span style="color:#888;font-size:0.72rem;">优先级图例：</span>';
    levelOrder.forEach(lv => {
        legendHtml += '<span class="prio-legend-item"><span class="prio-legend-dot" style="background:' + levelColor[lv] + ';"></span>' + lv + '</span>';
    });
    document.getElementById('prioLegend').innerHTML = legendHtml;

    const dedup = document.getElementById('dedupCheck').checked;
    const search = document.getElementById('detailSearch').value.toLowerCase();

    const targets = [plat];
    const coreModules = {};
    const seenNames = new Set();
    let totalModules = 0;

    for (const p of targets) {
        for (const m of (PLATFORMS[p] || [])) {
            if (m.category !== catName) continue;
            if (search && !m.name.toLowerCase().includes(search)) continue;
            if (dedup) {
                if (seenNames.has(m.name)) continue;
                seenNames.add(m.name);
            }
            totalModules++;
            for (const core of (m.cpu_cores || [])) {
                if (!coreModules[core]) coreModules[core] = [];
                const prio = m.priority !== null ? m.priority : 99;
                let level = '未配置';
                if (m.priority !== null) {
                    if (m.priority <= 2) level = '极高';
                    else if (m.priority <= 5) level = '高';
                    else if (m.priority <= 10) level = '中';
                    else level = '低';
                }
                coreModules[core].push({ name: m.name, prio: prio, level: level });
            }
        }
    }

    const coresArr = Object.keys(coreModules).map(Number).sort((a, b) => a - b);
    coresArr.forEach(core => { coreModules[core].sort((a, b) => a.prio - b.prio); });

    const maxStack = Math.max(1, ...coresArr.map(c => coreModules[c].length));

    const LABEL_H = 26;
    const series = [];
    for (let i = 0; i < maxStack; i++) {
        const data = coresArr.map(core => {
            const mod = coreModules[core][i];
            if (mod) {
                const labelText = mod.name + (mod.prio === 99 ? '' : ' [P' + mod.prio + ']');
                return {
                    value: LABEL_H,
                    name: mod.name,
                    prioVal: mod.prio,
                    prioLevel: mod.level,
                    itemStyle: {
                        color: levelColor[mod.level] || '#999',
                        borderColor: '#fff',
                        borderWidth: 1.5,
                        borderRadius: 3
                    },
                    label: {
                        show: true,
                        formatter: labelText,
                        fontSize: 11,
                        color: '#fff',
                        fontWeight: 600,
                        position: 'inside'
                    }
                };
            }
            return { value: 0.5, label: { show: false } };
        });
        series.push({
            type: 'bar',
            stack: 'total',
            data: data,
            barMaxWidth: 120,
            barMinWidth: 70,
            emphasis: {
                itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.35)' },
                label: { fontSize: 12 }
            }
        });
    }

    const totalHeight = Math.max(350, maxStack * LABEL_H + 150);
    document.getElementById('detailChart').style.height = totalHeight + 'px';
    if (detailChart) detailChart.resize();

    const filterInfo = search ? '（搜索 "' + document.getElementById('detailSearch').value + '"）' : '';
    document.getElementById('detailTitle').innerHTML = '\u300C' + catName + '\u300D核心-优先级分布 <small style="color:#2c8eb3;font-weight:600;font-size:0.8rem;">[' + plat + ']</small>' + filterInfo + '<small style="color:#888;font-weight:normal;font-size:0.8rem;"> 共 ' + totalModules + ' 个模块</small>';

    detailChart.setOption({
        tooltip: {
            trigger: 'item',
            formatter: function(p) {
                if (!p.data.prioVal) return '';
                return '<b>' + p.name + '</b><br/>CPU ' + coresArr[p.dataIndex]
                    + '<br/>优先级: ' + (p.data.prioVal === 99 ? '未配置' : p.data.prioVal)
                    + '<br/>级别: ' + p.data.prioLevel;
            }
        },
        legend: { show: false },
        grid: { left: 60, right: 40, top: 20, bottom: 50 },
        xAxis: {
            type: 'category',
            data: coresArr.map(c => 'CPU ' + c),
            name: 'CPU 核心',
            axisLabel: { fontSize: 12, fontWeight: 600 },
            axisTick: { alignWithLabel: true },
            axisLine: { lineStyle: { color: '#ccc' } }
        },
        yAxis: {
            type: 'value',
            name: '模块数（按优先级堆叠，越往上优先级越高）',
            axisLabel: { show: false },
            splitLine: { lineStyle: { type: 'dashed', color: '#eee' } },
            axisLine: { show: false },
            axisTick: { show: false }
        },
        series: series
    }, true);

    setTimeout(function() {
        if (shouldScroll) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (detailChart) detailChart.resize();
    }, 120);
}

function renderCoreDetail(core, plat) {
    currentDetailCore = core;
    currentDetailPlat = plat;
    _doRenderCoreDetail();
}

function _doRenderCoreDetail(shouldScroll) {
    if (shouldScroll === undefined) shouldScroll = true;
    const core = currentDetailCore;
    const plat = currentDetailPlat;
    const panel = document.getElementById('coreDetailPanel');
    panel.classList.add('show');
    if (!coreDetailChart) coreDetailChart = echarts.init(document.getElementById('coreDetailChart'));

    const levelColor = {
        '极高': '#c44545', '高': '#e28743', '中': '#f0a34b',
        '低': '#5fa7cf', '未配置': '#a0b8ce'
    };
    const levelOrder = ['极高', '高', '中', '低', '未配置'];
    let legendHtml = '<span style="color:#888;font-size:0.72rem;">优先级图例：</span>';
    levelOrder.forEach(lv => {
        legendHtml += '<span class="prio-legend-item"><span class="prio-legend-dot" style="background:' + levelColor[lv] + ';"></span>' + lv + '</span>';
    });
    document.getElementById('corePrioLegend').innerHTML = legendHtml;

    const dedup = document.getElementById('coreDedupCheck').checked;
    const search = document.getElementById('coreDetailSearch').value.toLowerCase();

    const targets = [plat];
    const catModules = {};
    const seenNames = new Set();
    let totalModules = 0;

    for (const p of targets) {
        for (const m of (PLATFORMS[p] || [])) {
            if (!modHasCore(m, core)) continue;
            if (!selectedCats.has(m.category)) continue;
            if (search && !m.name.toLowerCase().includes(search)) continue;
            if (dedup) {
                if (seenNames.has(m.name)) continue;
                seenNames.add(m.name);
            }
            totalModules++;
            const cat = m.category || '未分类';
            if (!catModules[cat]) catModules[cat] = [];
            const prio = m.priority !== null ? m.priority : 99;
            let level = '未配置';
            if (m.priority !== null) {
                if (m.priority <= 2) level = '极高';
                else if (m.priority <= 5) level = '高';
                else if (m.priority <= 10) level = '中';
                else level = '低';
            }
            catModules[cat].push({ name: m.name, prio: prio, level: level });
        }
    }

    const catsArr = Object.keys(catModules).sort((a, b) => {
        const idxA = CATS.indexOf(a), idxB = CATS.indexOf(b);
        return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });
    catsArr.forEach(cat => { catModules[cat].sort((a, b) => a.prio - b.prio); });

    const maxStack = Math.max(1, ...catsArr.map(c => catModules[c].length));

    const LABEL_H = 26;
    const series = [];
    for (let i = 0; i < maxStack; i++) {
        const data = catsArr.map(cat => {
            const mod = catModules[cat][i];
            if (mod) {
                const labelText = mod.name + (mod.prio === 99 ? '' : ' [P' + mod.prio + ']');
                return {
                    value: LABEL_H,
                    name: mod.name,
                    prioVal: mod.prio,
                    prioLevel: mod.level,
                    itemStyle: {
                        color: levelColor[mod.level] || '#999',
                        borderColor: '#fff',
                        borderWidth: 1.5,
                        borderRadius: 3
                    },
                    label: {
                        show: true,
                        formatter: labelText,
                        fontSize: 11,
                        color: '#fff',
                        fontWeight: 600,
                        position: 'inside'
                    }
                };
            }
            return { value: 0.5, label: { show: false } };
        });
        series.push({
            type: 'bar',
            stack: 'total',
            data: data,
            barMaxWidth: 120,
            barMinWidth: 70,
            emphasis: {
                itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.35)' },
                label: { fontSize: 12 }
            }
        });
    }

    const totalHeight = Math.max(350, maxStack * LABEL_H + 150);
    document.getElementById('coreDetailChart').style.height = totalHeight + 'px';
    if (coreDetailChart) coreDetailChart.resize();

    const filterInfo = search ? '（搜索 "' + document.getElementById('coreDetailSearch').value + '"）' : '';
    document.getElementById('coreDetailTitle').innerHTML = 'CPU ' + core + ' 涉及模块分布 <small style="color:#2c8eb3;font-weight:600;font-size:0.8rem;">[' + plat + ']</small>' + filterInfo + '<small style="color:#888;font-weight:normal;font-size:0.8rem;"> 共 ' + totalModules + ' 个模块</small>';

    coreDetailChart.setOption({
        tooltip: {
            trigger: 'item',
            formatter: function(p) {
                if (!p.data.prioVal) return '';
                return '<b>' + p.name + '</b><br/>分类: ' + catsArr[p.dataIndex]
                    + '<br/>优先级: ' + (p.data.prioVal === 99 ? '未配置' : p.data.prioVal)
                    + '<br/>级别: ' + p.data.prioLevel;
            }
        },
        legend: { show: false },
        grid: { left: 60, right: 40, top: 20, bottom: 50 },
        xAxis: {
            type: 'category',
            data: catsArr,
            name: '模块分类',
            axisLabel: { fontSize: 11, fontWeight: 600, interval: 0, rotate: catsArr.length > 6 ? 20 : 0 },
            axisTick: { alignWithLabel: true },
            axisLine: { lineStyle: { color: '#ccc' } }
        },
        yAxis: {
            type: 'value',
            name: '模块数（按优先级堆叠，越往上优先级越高）',
            axisLabel: { show: false },
            splitLine: { lineStyle: { type: 'dashed', color: '#eee' } },
            axisLine: { show: false },
            axisTick: { show: false }
        },
        series: series
    }, true);

    setTimeout(function() {
        if (shouldScroll) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (coreDetailChart) coreDetailChart.resize();
    }, 120);
}

function refreshCoreDetail() {
    if (currentDetailCore !== null) _doRenderCoreDetail(false);
}

function closeCoreDetail() {
    document.getElementById('coreDetailPanel').classList.remove('show');
    currentDetailCore = null;
}

function closeDetail() {
    document.getElementById('detailPanel').classList.remove('show');
    currentDetailCat = '';
}

(function init() {
    const sel = document.getElementById('platSelect');
    if (TARGET_PLATFORM && PLAT_NAMES.includes(TARGET_PLATFORM)) {
        const o = document.createElement('option');
        o.value = TARGET_PLATFORM;
        o.textContent = TARGET_PLATFORM;
        o.selected = true;
        sel.appendChild(o);
    } else {
        PLAT_NAMES.forEach(function(p) {
            const o = document.createElement('option');
            o.value = p;
            o.textContent = p;
            sel.appendChild(o);
        });
    }
    sel.style.display = '';
    const label = document.querySelector('label[for="platSelect"]');
    if (label) label.style.display = '';

    renderCatFilter();
    renderChart();
    window.addEventListener('resize', function() {
        if (mainChart) mainChart.resize();
        if (detailChart) detailChart.resize();
        if (coreDetailChart) coreDetailChart.resize();
    });
})();
</script>
</body>
</html>'''


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='生成核心负载分布柱状图 HTML 页面（含分类/核心下钻）')
    parser.add_argument("subdir", nargs="?", default=None,
                        help="Optional subdirectory under current working dir, e.g. ttx to use ./ttx")
    parser.add_argument('--package', default=None, help='Optional package directory')
    parser.add_argument('--input', default='./output/module_affinity.json', help='输入 JSON 文件，默认 module_affinity.json')
    parser.add_argument('--output', default='./output/module_affinity.html', help='输出 HTML 文件名')
    args = parser.parse_args()


    in_p = Path(args.input)
    input_path = in_p.resolve() if in_p.is_absolute() else (Path.cwd() / in_p).resolve()
    if not input_path.exists():
        print(f"❌ 错误: 找不到输入文件 {input_path}", file=sys.stderr)
        sys.exit(1)

    raw_data = json.loads(input_path.read_text(encoding="utf-8"))
    suffix = extract_v_suffix_from_m_package_files(raw_data)
    output_file = args.output
    if suffix and output_file.endswith(".html"):
        output_file = output_file[:-5] + suffix + ".html"
    out_p = Path(output_file)
    output_path = out_p.resolve() if out_p.is_absolute() else (Path.cwd() / out_p).resolve()

    generate_html(input_path, output_path)

    # If suffixed, also copy to the canonical requested path
    canon_p = Path(args.output)
    canonical_output = canon_p.resolve() if canon_p.is_absolute() else (Path.cwd() / canon_p).resolve()
    if output_path != canonical_output:
        import shutil
        shutil.copy2(output_path, canonical_output)