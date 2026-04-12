#include "todo_page.h"
#include <esp_log.h>

extern const lv_font_t SourceHanSansSC_Regular_slim;

namespace ui {

constexpr char kTag[] = "TodoPage";

TodoPage::TodoPage(lv_obj_t* parent) {
    // 创建列表容器
    list_ = lv_list_create(parent);
    lv_obj_set_size(list_, LV_PCT(100), LV_PCT(100));
    lv_obj_set_style_bg_color(list_, lv_color_white(), 0);
    lv_obj_set_style_border_width(list_, 0, 0);

    ESP_LOGI(kTag, "Todo page created");
}

TodoPage::~TodoPage() {
    // 子控件随 list 删除
}

void TodoPage::Clear() {
    for (lv_obj_t* item : items_) {
        lv_obj_delete(item);
    }
    items_.clear();
}

void TodoPage::SetItems(const std::vector<TodoItem>& items) {
    Clear();
    for (const TodoItem& item : items) {
        AddItem(item.text, item.completed);
    }
}

void TodoPage::AddItem(const std::string& text, bool completed) {
    // 使用 [x] 或 [ ] 作为前缀
    const char* prefix = completed ? "[x] " : "[ ] ";
    std::string full_text = prefix + text;

    lv_obj_t* btn = lv_list_add_button(list_, LV_SYMBOL_RIGHT, full_text.c_str());
    lv_obj_set_style_bg_color(btn, lv_color_white(), 0);
    lv_obj_set_style_border_width(btn, 0, 0);
    lv_obj_set_style_text_font(btn, &SourceHanSansSC_Regular_slim, 0);

    items_.push_back(btn);
}

void TodoPage::UpdateItem(int index, bool completed) {
    if (index >= 0 && index < static_cast<int>(items_.size())) {
        // TODO: 更新项状态，需要重新创建或修改文本
        // 简化实现：暂不支持动态更新
    }
}

void TodoPage::RemoveItem(int index) {
    if (index >= 0 && index < static_cast<int>(items_.size())) {
        lv_obj_delete(items_[index]);
        items_.erase(items_.begin() + index);
    }
}

void TodoPage::Refresh() {
    // LVGL 自动刷新
}

}  // namespace ui