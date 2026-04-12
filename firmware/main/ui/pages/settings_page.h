#ifndef SETTINGS_PAGE_H
#define SETTINGS_PAGE_H

#include <lvgl.h>
#include <functional>
#include <string>
#include <vector>

namespace ui {

// 设置项结构
struct SettingsItem {
    std::string label;                   // 显示文本
    std::string value;                   // 当前值
    std::function<void()> on_click;      // 点击回调
};

// 设置页面 - lv_list 组件
class SettingsPage {
public:
    SettingsPage(lv_obj_t* parent);
    ~SettingsPage();

    // 设置设置项列表
    void SetItems(const std::vector<SettingsItem>& items);

    // 更新单项显示值
    void UpdateItem(int index, const std::string& value);

    // 刷新显示
    void Refresh();

private:
    lv_obj_t* list_ = nullptr;           // lv_list 控件
    std::vector<lv_obj_t*> items_;       // 列表项控件
};

}  // namespace ui

#endif  // SETTINGS_PAGE_H