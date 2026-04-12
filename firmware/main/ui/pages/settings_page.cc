#include "settings_page.h"
#include <esp_log.h>

// 外部字体声明（支持中文）
extern const lv_font_t SourceHanSansSC_Regular_slim;

namespace ui {

constexpr char kTag[] = "SettingsPage";

SettingsPage::SettingsPage(lv_obj_t* parent) {
    // 创建 lv_list 控件
    list_ = lv_list_create(parent);
    lv_obj_set_size(list_, LV_PCT(100), LV_PCT(100));
    lv_obj_set_style_bg_color(list_, lv_color_white(), 0);

    ESP_LOGI(kTag, "Settings page created with lv_list");
}

SettingsPage::~SettingsPage() {
    // 子控件会随 list 删除而删除
}

void SettingsPage::SetItems(const std::vector<SettingsItem>& items) {
    // 清除现有项
    for (lv_obj_t* item : items_) {
        lv_obj_delete(item);
    }
    items_.clear();

    // 创建新列表项
    for (const SettingsItem& item : items) {
        lv_obj_t* btn = lv_list_add_button(list_, LV_SYMBOL_RIGHT, item.label.c_str());
        lv_obj_set_style_bg_color(btn, lv_color_white(), 0);
        lv_obj_set_style_border_width(btn, 0, 0);

        // 显示当前值（附加到按钮文本后）
        if (!item.value.empty()) {
            // 创建值标签
            lv_obj_t* value_label = lv_label_create(btn);
            lv_label_set_text(value_label, item.value.c_str());
            lv_obj_align(value_label, LV_ALIGN_RIGHT_MID, -8, 0);
        }

        // 设置点击回调
        if (item.on_click) {
            lv_obj_add_event_cb(btn, [](lv_event_t* e) {
                auto* callback = static_cast<std::function<void()>*>(lv_event_get_user_data(e));
                if (callback && *callback) {
                    (*callback)();
                }
            }, LV_EVENT_CLICKED, new std::function<void()>(item.on_click));
        }

        items_.push_back(btn);
    }
}

void SettingsPage::UpdateItem(int index, const std::string& value) {
    if (index >= 0 && index < static_cast<int>(items_.size())) {
        lv_obj_t* btn = items_[index];
        // 查找值标签（第二个子控件）
        lv_obj_t* value_label = lv_obj_get_child(btn, 1);
        if (value_label) {
            lv_label_set_text(value_label, value.c_str());
        }
    }
}

void SettingsPage::Refresh() {
    // LVGL 会自动处理刷新
}

}  // namespace ui