#!/bin/bash
set -eo pipefail

# 获取脚本所在目录和工作区目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${PIPELINE_WORKSPACE:-$(pwd)}"
cd "$WORKSPACE"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Local Package Tool - Mini Pipeline 插件${NC}"
echo -e "${GREEN}========================================${NC}"
echo "工作空间: $WORKSPACE"
echo "插件目录: $SCRIPT_DIR"

# 1. 解析整包名称 (full_package_name)
full_package_name=""

# 优先级 1: 命令行参数 $1
if [ -n "${1:-}" ]; then
    full_package_name="$1"
fi

# 优先级 2: 从 params.json 获取
if [ -z "$full_package_name" ] && [ -f "params.json" ]; then
    full_package_name=$(python3 -c "import json; d=json.load(open('params.json')); print(d.get('full_package_name', ''))" 2>/dev/null || true)
fi

# 优先级 3: 从 input/full_package_name.txt 或 input/full_package_name 获取
if [ -z "$full_package_name" ]; then
    if [ -f "input/full_package_name.txt" ]; then
        full_package_name=$(cat "input/full_package_name.txt" | tr -d '\r\n')
    elif [ -f "input/full_package_name" ]; then
        full_package_name=$(cat "input/full_package_name" | tr -d '\r\n')
    fi
fi

# 优先级 4: 环境变量
if [ -z "$full_package_name" ] && [ -n "${FULL_PACKAGE_NAME:-}" ]; then
    full_package_name="$FULL_PACKAGE_NAME"
fi

if [ -z "$full_package_name" ]; then
    echo -e "${RED}错误: 未提供整包名称 full_package_name！${NC}"
    echo "请在流水线参数中配置 full_package_name 或传入参数。"
    exit 1
fi

echo -e "${BLUE}目标整包名称: ${GREEN}$full_package_name${NC}"

# 定义路径
im_package_path="input/im"
m_package_path="input/m"
modules_package_path="input/modules"
output_path="output"

mkdir -p "$output_path"

# 检查压缩工具
TAR_COMPRESS_OPTS=()
if command -v pigz &>/dev/null; then
    TAR_COMPRESS_OPTS=("-I" "pigz")
else
    echo -e "${YELLOW}警告: 未找到 pigz 工具，回退使用标准 gzip 压缩${NC}"
    TAR_COMPRESS_OPTS=("-z")
fi

# 辅助函数
get_variant_from_name() {
    local name="$1"
    if echo "$name" | grep -qi 'RIPD'; then
        echo "RIPD"
    elif echo "$name" | grep -qi 'IPD'; then
        echo "IPD"
    else
        echo ""
    fi
}

format_size() {
    local bytes=$1
    if [ "$bytes" -ge 1073741824 ] 2>/dev/null; then
        awk -v b="$bytes" 'BEGIN { printf "%.2fG", b/1073741824 }'
    elif [ "$bytes" -ge 1048576 ] 2>/dev/null; then
        awk -v b="$bytes" 'BEGIN { printf "%.2fM", b/1048576 }'
    elif [ "$bytes" -ge 1024 ] 2>/dev/null; then
        awk -v b="$bytes" 'BEGIN { printf "%.2fK", b/1024 }'
    else
        echo "${bytes}B"
    fi
}

check_folder() {
    local folder="$1"
    local target_var="$2"
    local files=()

    if [ -d "$folder" ]; then
        shopt -s nullglob
        for file in "$folder"/*; do
            [ "$(basename "$file")" = ".gitkeep" ] && continue
            [ -f "$file" ] && files+=("$file")
        done
        shopt -u nullglob
    fi

    if [ ${#files[@]} -eq 0 ]; then
        echo -e "${RED}错误: $folder 目录为空或未找到有效文件！${NC}"
        exit 1
    elif [ ${#files[@]} -gt 1 ]; then
        echo -e "${RED}错误: $folder 目录中存在多个文件！${NC}"
        for f in "${files[@]}"; do
            echo "  - $f"
        done
        exit 1
    else
        local file="${files[0]}"
        echo -e "${BLUE}在 $folder 中找到唯一文件: $file${NC}"
        eval "$target_var='$file'"
    fi
}

check_empty_modules() {
    local modules_dir="$1"
    if [ ! -d "$modules_dir" ]; then
        return
    fi
    shopt -s nullglob
    for dir in "$modules_dir"/*; do
        if [ -d "$dir" ]; then
            local files=("$dir"/*)
            if [ ${#files[@]} -eq 0 ]; then
                echo -e "${RED}错误: 模块子目录 $dir 为空！${NC}"
                exit 1
            fi
        fi
    done
    shopt -u nullglob
}

extract_m_package() {
    local variant="$1"
    local target_dir="$2"
    local m_file="$3"
    local excludes=()

    if [ "$variant" = "RIPD" ]; then
        excludes=(
            --exclude="modules/camera_detection/resource/models-release/lane_detection_3d_models/max_model.tar"
            --exclude="modules/camera_detection/resource/models-release/desen_models/models_max.tar"
            --exclude="modules/camera_detection/resource/models-release/onemodel_models"
            --exclude="modules/camera_detection/resource/models-release/ground_line_models"
            --exclude="modules/camera_detection/resource/models-release/parking_slot_models"
            --exclude="modules/lidar_perception/resource/model/cgd_max.tar"
            --exclude="modules/lidar_perception/resource/model/lidar_max.tar"
            --exclude="modules/vehicle_service"
            --exclude="modules/hmi_service"
            --exclude="modules/ws2_recorder"
            --exclude="modules/tmas_time_sync"
            --exclude="modules/DiagnosticsService"
            --exclude="modules/dd_parking_fusion"
            --exclude="modules/parking_fusion"
            --exclude="modules/apa_planning"
            --exclude="modules/map_provider_pnp"
            --exclude="modules/lpnp_online_mapping"
            --exclude="modules/pnp_planning"
        )
    elif [ "$variant" = "IPD" ]; then
        excludes=(
            --exclude="modules/camera_detection/resource/models-release/lane_detection_3d_models/pro_model.tar"
            --exclude="modules/camera_detection/resource/models-release/desen_models/models_pro.tar"
            --exclude="modules/lidar_perception/resource/model/cgd_pro.tar"
            --exclude="modules/lidar_perception/resource/model/lidar_pro.tar"
            --exclude="modules/unp_planning/resource/models/dlp_unp_ddld_model_side.tar"
            --exclude="modules/vehicle_service_RIPD"
            --exclude="modules/sensor_service_RIPD"
            --exclude="modules/hmi_service_RIPD"
            --exclude="modules/ws2_recorder_RIPD"
            --exclude="modules/tmas_time_sync_RIPD"
            --exclude="modules/DiagnosticsService_RIPD"
        )
    fi

    mkdir -p "$target_dir"
    echo -e "${YELLOW}解压 M 包到 $target_dir${NC}"
    if [ ${#excludes[@]} -gt 0 ]; then
        tar -xzf "$m_file" "${excludes[@]}" -C "$target_dir"
    else
        tar -xzf "$m_file" -C "$target_dir"
    fi

    # 规范化 M 包目录层级（若压缩包内包含顶层目录如 m/ 或包名目录，提至 target_dir 根下）
    if [ ! -d "$target_dir/modules" ]; then
        for sub in "$target_dir"/*; do
            if [ -d "$sub/modules" ]; then
                cp -arf "$sub"/* "$target_dir/" 2>/dev/null || true
                rm -rf "$sub"
                break
            fi
        done
    fi

}

process_modules() {
    local variant="$1"
    local im_modules_dir="$2"
    local modules_files=()
    local integrated_modules=()

    if [ -d "$modules_package_path" ]; then
        shopt -s nullglob
        while IFS= read -r -d '' file; do
            [ "$(basename "$file")" = ".gitkeep" ] && continue
            modules_files+=("$file")
        done < <(find "$modules_package_path" -type f \( -name "*.tar.gz" -o -name "*.zip" \) -print0)
        shopt -u nullglob
    fi

    if [ ${#modules_files[@]} -eq 0 ]; then
        echo -e "${BLUE}modules 目录为空，跳过第三方模块处理${NC}"
        return
    fi

    mkdir -p "$im_modules_dir"

    for module_file in "${modules_files[@]}"; do
        local module_name
        module_name=$(basename "$module_file")
        local should_include=true

        if [ ${#modules_files[@]} -gt 1 ] && [ -n "$variant" ]; then
            local module_variant
            module_variant=$(get_variant_from_name "$module_name")
            if [ -n "$module_variant" ] && [ "$module_variant" != "$variant" ]; then
                should_include=false
            fi
        fi

        if [ "$should_include" = true ]; then
            echo -e "${BLUE}集成模块: $module_name 到 $im_modules_dir${NC}"
            integrated_modules+=("$module_name")
            if [[ "$module_file" == *.tar.gz ]]; then
                tar -zxf "$module_file" -C "$im_modules_dir"
            elif [[ "$module_file" == *.zip ]]; then
                unzip -qq -o "$module_file" -d "$im_modules_dir"
            else
                echo -e "${RED}不支持的模块文件格式: $module_file${NC}"
                exit 1
            fi
        fi
    done

    if [ ${#integrated_modules[@]} -gt 0 ]; then
        echo -e "${GREEN}已集成的模块列表:${NC}"
        for mod in "${integrated_modules[@]}"; do
            echo -e "${GREEN}  - $mod${NC}"
        done
    fi
}

generate_readme() {
    local readme_file="$1"
    local mode="$2"
    local im_version="$3"
    local m_version="$4"

    if [ "$mode" = "multi" ]; then
        cat > "$readme_file" << 'EOF_MULTI'
将压缩包上传至除app外其他目录下（如 /opt/update/）
目前/app目录只读，需赋予读写权限
mount -uw /app
mount -uw /
将/app目录下m和im清空
cd /app
rm -rf im m
cd /opt/m/dmz
若存在dmz文件夹
在dmz文件夹下rm -rf *
若不存在跳过
跳转至压缩包位置
cd /opt/update/xxx.tar.gz
指定位置解压
tar -zxvf xxx.tar.gz -C /app
cd /app/m/modules/startup_config/utils/
./preInstall.sh
防止部署包后一些临时文件消失，将数据落盘一下
sync

整车断电等待两分钟

==============================
版本信息
==============================

IM Version:
EOF_MULTI
        echo "$im_version" >> "$readme_file"
        echo "" >> "$readme_file"
        echo "M Version:" >> "$readme_file"
        echo "$m_version" >> "$readme_file"
    elif [ "$mode" = "im_only" ]; then
        cat > "$readme_file" << 'EOF_IM'
将压缩包上传至除app外其他目录下
目前/app目录只读，需赋予读写权限
mount -o remount rw /app
将/app目录下im清空（保留 m 目录）
cd /app
rm -rf im
跳转至压缩包位置
cd xxxx
指定位置解压
tar -C /app -xzf xxxx
防止部署包后一些临时文件消失，将数据落盘一下
sync

整车断电等待两分钟

==============================
版本信息
==============================

IM Version:
EOF_IM
        echo "$im_version" >> "$readme_file"
    else
        cat > "$readme_file" << 'EOF_SINGLE'
将压缩包上传至除app外其他目录下
目前/app目录只读，需赋予读写权限
mount -o remount rw /app
将/app目录下m和im清空
cd /app
rm -rf im m
cd /opt/m/dmz
若存在dmz文件夹
在dmz文件夹下rm -rf *
若不存在跳过
跳转至压缩包位置
cd xxxx
指定位置解压
tar -C /app -xzf xxxx
cd /app/m/modules/startup_config/utils/
./preInstall.sh
防止部署包后一些临时文件消失，将数据落盘一下
sync

整车断电等待两分钟

==============================
版本信息
==============================

IM Version:
EOF_SINGLE
        echo "$im_version" >> "$readme_file"
        echo "" >> "$readme_file"
        echo "M Version:" >> "$readme_file"
        echo "$m_version" >> "$readme_file"
    fi
}

build_im_modules_package() {
    local im_file="$1"
    local target_output_dir="$2"
    local variant="$3"
    local mode_label="$4"

    local im_basename pkg_base im_work_dir im_modules_dir
    local tmp_dir="app_im_tmp"

    im_basename=$(basename "$im_file")
    pkg_base="${im_basename%.tar.gz}"

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}开始生成 im + modules 汇总产物 ($mode_label, $variant)${NC}"
    echo -e "${GREEN}汇总产物名: ${pkg_base}.tar.gz${NC}"
    echo -e "${GREEN}========================================${NC}"

    rm -rf "$tmp_dir"
    mkdir -p "$tmp_dir"

    echo -e "${YELLOW}解压 IM 包到 $tmp_dir: $im_file${NC}"
    tar -xzf "$im_file" -C "$tmp_dir"

    if [ -d "$tmp_dir/app/im" ]; then
        im_work_dir="$tmp_dir/app/im"
    elif [ -d "$tmp_dir/im" ]; then
        im_work_dir="$tmp_dir/im"
    else
        echo -e "${RED}错误: 解压IM包后未找到 $tmp_dir/app/im 或 $tmp_dir/im 目录！${NC}"
        rm -rf "$tmp_dir"
        exit 1
    fi
    im_modules_dir="$im_work_dir/modules"

    echo -e "${YELLOW}处理 modules${NC}"
    process_modules "$variant" "$im_modules_dir"

    echo -e "${YELLOW}打包 im + modules 汇总产物${NC}"
    local pkg_cd_dir="$tmp_dir"
    if [ "$im_work_dir" = "$tmp_dir/im" ]; then
        mkdir -p "$tmp_dir/app"
        mv "$tmp_dir/im" "$tmp_dir/app/"
    fi

    tar "${TAR_COMPRESS_OPTS[@]}" -cf "$target_output_dir/$pkg_base.tar.gz" -C "$pkg_cd_dir" app

    echo -e "${YELLOW}生成 checksum 文件${NC}"
    local checksum_file="$target_output_dir/$pkg_base.checksum.txt"
    md5sum "$target_output_dir/$pkg_base.tar.gz" > "$checksum_file"

    echo -e "${YELLOW}生成 readme 文件${NC}"
    local im_version
    im_version=$(cat "$im_work_dir/.version" 2>/dev/null || echo "Unknown")
    generate_readme "$target_output_dir/$pkg_base.readme.txt" "im_only" "$im_version" ""

    rm -rf "$tmp_dir"
    echo -e "${GREEN}im + modules 汇总产物生成完成: ${pkg_base}.tar.gz${NC}"
}

build_variant_package() {
    local package_name="$1"
    local im_file="$2"
    local m_file="$3"
    local variant="$4"
    local build_dir="$package_name"
    local im_work_dir=""
    local im_modules_dir=""

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}构建整包: $package_name ($variant)${NC}"
    echo -e "${GREEN}========================================${NC}"

    rm -rf app/ "$build_dir"
    mkdir -p "$build_dir"

    echo -e "${YELLOW}解压 IM 包: $im_file${NC}"
    tar -xzf "$im_file"

    if [ -d "app/im" ]; then
        im_work_dir="app/im"
    elif [ -d "im" ]; then
        im_work_dir="im"
    else
        echo -e "${RED}错误: 解压IM包后未找到 app/im 或 im 目录！${NC}"
        exit 1
    fi

    im_modules_dir="$im_work_dir/modules"
    local variant_output="$output_path/$package_name"
    rm -rf "$variant_output"
    mkdir -p "$variant_output"

    echo -e "${YELLOW}处理 modules${NC}"
    process_modules "$variant" "$im_modules_dir"

    # 判断是否有第三方模块
    local _im_modules_count=0
    if [ -d "$modules_package_path" ]; then
        shopt -s nullglob
        while IFS= read -r -d '' _f; do
            [ "$(basename "$_f")" = ".gitkeep" ] && continue
            _im_modules_count=$((_im_modules_count + 1))
        done < <(find "$modules_package_path" -type f \( -name "*.tar.gz" -o -name "*.zip" \) -print0)
        shopt -u nullglob
    fi
    if [ "$_im_modules_count" -gt 0 ]; then
        build_im_modules_package "$im_file" "$variant_output" "$variant" "multi"
    fi

    echo -e "${YELLOW}拷贝 IM 产物到构建目录${NC}"
    cp -arf "$im_work_dir" "$build_dir/im"
    check_empty_modules "$build_dir/im/modules"

    echo -e "${YELLOW}解压并处理 M 包${NC}"
    extract_m_package "$variant" "$build_dir/m" "$m_file"

    echo -e "${YELLOW}生成绑核分析文件${NC}"
    if [ -f "$SCRIPT_DIR/get_affinity_json.py" ]; then
        python3 "$SCRIPT_DIR/get_affinity_json.py" --root . --package "$build_dir" --output "$variant_output/module_affinity.json" || echo -e "${YELLOW}绑核 JSON 生成跳过或失败${NC}"
    fi
    if [ -f "$SCRIPT_DIR/get_affinity_html.py" ] && [ -f "$variant_output/module_affinity.json" ]; then
        python3 "$SCRIPT_DIR/get_affinity_html.py" --input "$variant_output/module_affinity.json" --output "$variant_output/module_affinity.html" --package "$build_dir" || echo -e "${YELLOW}绑核 HTML 生成跳过或失败${NC}"
    fi

    echo -e "${YELLOW}打包总整包: $package_name.tar.gz${NC}"
    tar "${TAR_COMPRESS_OPTS[@]}" -cf "$variant_output/$package_name.tar.gz" -C "$build_dir" im m

    echo -e "${YELLOW}生成 checksum${NC}"
    local checksum_file="$variant_output/$package_name.checksum.txt"
    md5sum "$variant_output/$package_name.tar.gz" > "$checksum_file"

    echo -e "${YELLOW}生成 readme${NC}"
    local im_version
    local m_version
    im_version=$(cat "$build_dir/im/.version" 2>/dev/null || echo "Unknown")
    m_version=$(cat "$build_dir/m/.version" 2>/dev/null || echo "Unknown")
    generate_readme "$variant_output/$package_name.readme.txt" "multi" "$im_version" "$m_version"

    # 清理中间构建目录
    rm -rf app/ "$build_dir"
    echo -e "${GREEN}整包 $package_name 构建完成！${NC}"
}

# 2. 扫描并验证输入包
im_files=()
if [ -d "$im_package_path" ]; then
    shopt -s nullglob
    for file in "$im_package_path"/*; do
        [ "$(basename "$file")" = ".gitkeep" ] && continue
        [ -f "$file" ] && im_files+=("$file")
    done
    shopt -u nullglob
fi

if [ ${#im_files[@]} -eq 0 ]; then
    echo -e "${RED}错误: input/im 目录中未找到 IM 包！${NC}"
    echo "请上传 SOC 自研 IM 包到 im_package。"
    exit 1
fi

m_file_path=""
check_folder "$m_package_path" m_file_path

# 3. 运行模式分流
if [ ${#im_files[@]} -gt 1 ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}检测到多包模式 (发现 ${#im_files[@]} 个 IM 包)${NC}"
    echo -e "${GREEN}========================================${NC}"

    for im_file in "${im_files[@]}"; do
        im_basename=$(basename "$im_file")
        variant=$(get_variant_from_name "$im_basename")

        if [ -z "$variant" ]; then
            echo -e "${RED}错误: 无法从文件名识别变体 (IPD/RIPD): $im_basename${NC}"
            exit 1
        fi

        base_name="$full_package_name"
        if echo "$base_name" | grep -qi 'IPD'; then
            base_name=$(echo "$base_name" | sed -E 's/[Ii][Pp][Dd]/PLACEHOLDER/g')
        elif echo "$base_name" | grep -qi 'RIPD'; then
            base_name=$(echo "$base_name" | sed -E 's/[Rr][Ii][Pp][Dd]/PLACEHOLDER/g')
        else
            base_name="${base_name}_PLACEHOLDER"
        fi
        new_package_name=$(echo "$base_name" | sed "s/PLACEHOLDER/$variant/g")

        build_variant_package "$new_package_name" "$im_file" "$m_file_path" "$variant"
    done
else
    # 单包模式
    im_file_path="${im_files[0]}"
    detected_variant=$(get_variant_from_name "$(basename "$im_file_path")")
    [ -z "$detected_variant" ] && detected_variant="IPD"

    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}单包模式: 变体 $detected_variant${NC}"
    echo -e "${GREEN}整包名称: $full_package_name.tar.gz${NC}"
    echo -e "${GREEN}========================================${NC}"

    single_output="$output_path/$full_package_name"
    rm -rf "$single_output" app/ "$full_package_name"
    mkdir -p "$single_output" "$full_package_name"

    echo -e "${YELLOW}Step 1: 解压 M 压缩包${NC}"
    extract_m_package "$detected_variant" "$full_package_name/m" "$m_file_path"

    echo -e "${YELLOW}Step 2: 解压 IM 压缩包${NC}"
    tar -xzf "$im_file_path"
    if [ -d "app/im" ]; then
        im_path="app/im"
    elif [ -d "im" ]; then
        im_path="im"
    else
        echo -e "${RED}错误: 解压IM包后未找到 app/im 或 im 目录！${NC}"
        exit 1
    fi
    im_modules_path="$im_path/modules"

    echo -e "${YELLOW}Step 3: 处理第三方模块${NC}"
    process_modules "$detected_variant" "$im_modules_path"

    # 若有模块则生成 im+modules 产物
    _modules_count=0
    if [ -d "$modules_package_path" ]; then
        shopt -s nullglob
        while IFS= read -r -d '' _f; do
            [ "$(basename "$_f")" = ".gitkeep" ] && continue
            _modules_count=$((_modules_count + 1))
        done < <(find "$modules_package_path" -type f \( -name "*.tar.gz" -o -name "*.zip" \) -print0)
        shopt -u nullglob
    fi
    if [ "$_modules_count" -gt 0 ]; then
        build_im_modules_package "$im_file_path" "$single_output" "$detected_variant" "single"
    fi

    echo -e "${YELLOW}Step 4: 拷贝 IM 产物${NC}"
    cp -arf "$im_path" "$full_package_name/im"
    check_empty_modules "$im_modules_path"

    echo -e "${YELLOW}Step 5: 生成绑核元数据与可视化报表${NC}"
    if [ -f "$SCRIPT_DIR/get_affinity_json.py" ]; then
        python3 "$SCRIPT_DIR/get_affinity_json.py" --root . --package "$full_package_name" --output "$single_output/module_affinity.json" || echo -e "${YELLOW}绑核 JSON 生成跳过或失败${NC}"
    fi
    if [ -f "$SCRIPT_DIR/get_affinity_html.py" ] && [ -f "$single_output/module_affinity.json" ]; then
        python3 "$SCRIPT_DIR/get_affinity_html.py" --input "$single_output/module_affinity.json" --output "$single_output/module_affinity.html" --package "$full_package_name" || echo -e "${YELLOW}绑核 HTML 生成跳过或失败${NC}"
    fi

    echo -e "${YELLOW}Step 6: 打包总整包${NC}"
    tar "${TAR_COMPRESS_OPTS[@]}" -cf "$single_output/$full_package_name.tar.gz" -C "$full_package_name" im m

    echo -e "${YELLOW}Step 7: 生成 checksum 文件${NC}"
    md5sum "$single_output/$full_package_name.tar.gz" > "$single_output/$full_package_name.checksum.txt"

    echo -e "${YELLOW}Step 8: 生成 readme 文件${NC}"
    im_version=$(cat "$full_package_name/im/.version" 2>/dev/null || echo "Unknown")
    m_version=$(cat "$full_package_name/m/.version" 2>/dev/null || echo "Unknown")
    generate_readme "$single_output/$full_package_name.readme.txt" "single" "$im_version" "$m_version"

    echo -e "${YELLOW}Step 9: 清理临时目录${NC}"
    rm -rf app/ "$full_package_name"
    echo -e "${GREEN}打包成功！产物已输出至: $single_output${NC}"
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  全部流程执行完成！${NC}"
echo -e "${GREEN}========================================${NC}"
ls -lh "$output_path"/* || true
