#ifndef TODO_PAGE_H
#define TODO_PAGE_H

#include <lvgl.h>
#include <string>
#include <vector>

namespace ui {

// Todo 任务项
struct TodoItem {
    std::string text;
    bool completed = false;
};

// Todo 页面 - 任务列表
class TodoPage {
public:
    TodoPage(lv_obj_t* parent);
    ~TodoPage();

    // 清空列表
    void Clear();

    // 设置任务列表
    void SetItems(const std::vector<TodoItem>& items);

    // 添加任务
    void AddItem(const std::string& text, bool completed = false);

    // 更新任务状态
    void UpdateItem(int index, bool completed);

    // 删除任务
    void RemoveItem(int index);

    // 刷新显示
    void Refresh();

private:
    lv_obj_t* list_ = nullptr;        // lv_list 容器
    std::vector<lv_obj_t*> items_;    // 列表项控件
};

}  // namespace ui

#endif  // TODO_PAGE_H