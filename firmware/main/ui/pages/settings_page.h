#ifndef SETTINGS_PAGE_H
#define SETTINGS_PAGE_H

#include <lvgl.h>
#include <functional>
#include <string>
#include <vector>

namespace ui {

// 设置项类型
enum class SettingsItemType {
    Normal,    // 普通项，显示 >
    Checkbox,  // 可勾选项，显示 [x] 或 [ ]
    Action,    // 操作项，显示 >
};

// 设置项结构
struct SettingsItem {
    std::string label;                   // 显示文本
    std::string value;                   // 当前值（可选）
    SettingsItemType type = SettingsItemType::Normal;
    bool checked = false;                // Checkbox 类型的选中状态
    std::function<void()> on_click;      // 点击回调
};

// 设置页面 - lv_list 组件（spec_v2 扁平化列表菜单）
class SettingsPage {
public:
    SettingsPage(lv_obj_t* parent);
    ~SettingsPage();

    // 设置设置项列表
    void SetItems(const std::vector<SettingsItem>& items);

    // 更新单项显示值
    void UpdateItem(int index, const std::string& value);

    // 更新 Checkbox 项的选中状态
    void UpdateChecked(int index, bool checked);

    // 刷新显示
    void Refresh();

private:
    lv_obj_t* list_ = nullptr;           // lv_list 控件
    std::vector<lv_obj_t*> items_;       // 列表项控件
    std::vector<SettingsItem> item_data_; // 保存项数据
    std::vector<std::function<void()>*> callbacks_; // 回调指针，用于释放内存

    // 获取项的前缀符号
    const char* GetItemSymbol(const SettingsItem& item) const;
};

}  // namespace ui

#endif  // SETTINGS_PAGE_H