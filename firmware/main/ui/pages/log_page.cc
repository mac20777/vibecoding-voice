#include "log_page.h"
#include <esp_log.h>

extern const lv_font_t SourceHanSansSC_Regular_slim;

namespace ui {

constexpr char kTag[] = "LogPage";

LogPage::LogPage(lv_obj_t* parent) {
    // 创建容器
    container_ = lv_obj_create(parent);
    lv_obj_set_size(container_, LV_PCT(100), LV_PCT(100));
    lv_obj_set_style_bg_color(container_, lv_color_white(), 0);
    lv_obj_set_style_border_width(container_, 0, 0);
    lv_obj_set_style_pad_all(container_, 8, 0);

    // 创建日志文本标签（多行滚动）
    log_label_ = lv_label_create(container_);
    lv_obj_set_size(log_label_, LV_PCT(100), LV_PCT(100));
    lv_obj_set_style_text_font(log_label_, &SourceHanSansSC_Regular_slim, 0);
    lv_label_set_long_mode(log_label_, LV_LABEL_LONG_WRAP);
    lv_label_set_text(log_label_, "系统日志\n等待初始化...");

    ESP_LOGI(kTag, "Log page created");
}

LogPage::~LogPage() {
    // 子控件随容器删除
}

void LogPage::Clear() {
    entries_.clear();
    lv_label_set_text(log_label_, "");
}

void LogPage::AddEntry(const std::string& text, int level) {
    // 添加日志前缀
    const char* prefix = "";
    switch (level) {
        case 1: prefix = "[WARN] "; break;
        case 2: prefix = "[ERR] "; break;
        default: prefix = "[INFO] "; break;
    }

    entries_.push_back(prefix + text);

    // 更新显示
    std::string full_text;
    for (const std::string& entry : entries_) {
        full_text += entry + "\n";
    }
    lv_label_set_text(log_label_, full_text.c_str());
}

void LogPage::SetEntries(const std::vector<LogEntry>& entries) {
    Clear();
    for (const LogEntry& entry : entries) {
        AddEntry(entry.text, entry.level);
    }
}

void LogPage::Refresh() {
    // LVGL 自动刷新
}

}  // namespace ui