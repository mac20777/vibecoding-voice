#include "todo_page.h"
#include <esp_log.h>
#include <widgets/label/lv_label.h>  // for lv_label_class

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
    texts_.clear();
}

void TodoPage::SetItems(const std::vector<TodoItem>& items) {
    Clear();
    for (const TodoItem& item : items) {
        AddItem(item.text, item.completed);
    }
}

void TodoPage::AddItem(const std::string& text, bool completed) {
    // 存储原始文本
    texts_.push_back(text);

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
        // 更新状态前缀
        const char* prefix = completed ? "[x] " : "[ ] ";
        std::string full_text = prefix + texts_[index];

        // 获取按钮内的 label 子控件并更新文本
        // lv_list_add_button 创建的按钮包含 icon + label
        // 查找 label 子控件（通常是最后一个子对象）
        lv_obj_t* btn = items_[index];
        uint32_t child_cnt = lv_obj_get_child_count(btn);
        for (uint32_t i = 0; i < child_cnt; ++i) {
            lv_obj_t* child = lv_obj_get_child(btn, i);
            // 检查是否是 label（通过类名）
            if (lv_obj_check_type(child, &lv_label_class)) {
                lv_label_set_text(child, full_text.c_str());
                break;
            }
        }
    }
}

void TodoPage::RemoveItem(int index) {
    if (index >= 0 && index < static_cast<int>(items_.size())) {
        lv_obj_delete(items_[index]);
        items_.erase(items_.begin() + index);
        texts_.erase(texts_.begin() + index);
    }
}

void TodoPage::Refresh() {
    // LVGL 自动刷新
}

}  // namespace ui