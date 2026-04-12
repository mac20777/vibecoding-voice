#include "status_bar.h"
#include <esp_log.h>

// 外部字体声明（支持中文）
extern const lv_font_t SourceHanSansSC_Regular_slim;
extern const lv_font_t font_zectrix_16_1;

namespace ui {

constexpr char kTag[] = "StatusBar";

StatusBar::StatusBar(lv_obj_t* parent) {
    // 创建状态栏容器（固定在顶部）
    container_ = lv_obj_create(parent);
    lv_obj_set_size(container_, 400, GetHeight());
    lv_obj_set_pos(container_, 0, 0);
    lv_obj_set_style_bg_color(container_, lv_color_white(), 0);
    lv_obj_set_style_pad_all(container_, 4, 0);
    lv_obj_set_style_border_width(container_, 0, 0);
    lv_obj_set_style_radius(container_, 0, 0);

    // WiFi 图标（左侧）
    wifi_icon_ = lv_label_create(container_);
    lv_obj_set_pos(wifi_icon_, 8, 8);
    lv_obj_set_style_text_font(wifi_icon_, &font_zectrix_16_1, 0);
    lv_label_set_text(wifi_icon_, LV_SYMBOL_WIFI);  // 暂用 LVGL 内置图标

    // 状态文本（WiFi/服务状态）
    status_text_ = lv_label_create(container_);
    lv_obj_set_pos(status_text_, 24, 8);
    lv_obj_set_style_text_font(status_text_, &SourceHanSansSC_Regular_slim, 0);
    lv_label_set_text(status_text_, "");

    // 页面标题（中间）
    title_label_ = lv_label_create(container_);
    lv_obj_set_style_text_font(title_label_, &SourceHanSansSC_Regular_slim, 0);
    lv_label_set_text(title_label_, "对话");
    lv_obj_align(title_label_, LV_ALIGN_CENTER, 0, 0);

    // 电池标签（右侧）
    battery_label_ = lv_label_create(container_);
    lv_obj_set_pos(battery_label_, 340, 8);
    lv_obj_set_style_text_font(battery_label_, &SourceHanSansSC_Regular_slim, 0);
    lv_label_set_text(battery_label_, "--%");

    ESP_LOGI(kTag, "Status bar created");
}

StatusBar::~StatusBar() {
    if (container_) {
        lv_obj_delete(container_);
    }
}

void StatusBar::Update(const StatusBarData& data) {
    // 更新 WiFi 图标
    if (wifi_icon_) {
        if (data.wifi_connected) {
            lv_obj_set_style_text_color(wifi_icon_, lv_color_black(), 0);
            lv_label_set_text(wifi_icon_, LV_SYMBOL_WIFI);
        } else {
            lv_obj_set_style_text_color(wifi_icon_, lv_color_make(0x80, 0x80, 0x80), 0);
            lv_label_set_text(wifi_icon_, LV_SYMBOL_WARNING);
        }
    }

    // 更新状态文本
    if (status_text_) {
        std::string status;
        if (!data.wifi_connected) {
            status = "WiFi断开";
        } else if (!data.server_connected) {
            status = "服务离线";
        } else {
            status = "";  // 已连接时不显示
        }
        lv_label_set_text(status_text_, status.c_str());
    }

    // 更新页面标题
    if (title_label_) {
        lv_label_set_text(title_label_, data.page_title.c_str());
    }

    // 更新电池显示（横向 3 节）
    if (battery_label_) {
        std::string battery_text;
        if (data.battery_level >= 0) {
            battery_text = std::to_string(data.battery_level) + "%";
            if (data.battery_charging) {
                battery_text += "+";
            }
            // 低电量警告（<20%）
            if (data.battery_level < 20 && !data.battery_charging) {
                battery_text = "!" + battery_text;
            }
        } else {
            battery_text = "--%";
        }
        lv_label_set_text(battery_label_, battery_text.c_str());
    }
}

void StatusBar::Refresh() {
    // LVGL 会自动处理刷新
}

void StatusBar::DrawBattery3Cell(lv_obj_t* canvas, int level, bool charging) {
    // 横向 3 节电池：外包矩形，内部按 3 格划分
    // 0-33%: 1 格, 34-66%: 2 格, 67-100%: 3 格
    // 此方法用于 canvas 绘制，暂时用 label 文字代替
    (void)canvas;
    (void)level;
    (void)charging;
}

}  // namespace ui