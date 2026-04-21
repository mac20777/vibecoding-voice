# BMI270 桌面前推检测示例

## 概述

本示例演示如何使用 BMI270 传感器进行桌面前推手势检测。

## 功能特点

- **多轴检测**：支持 X、Y、Z 三个前推方向
- **低功耗**：BMI270 INT 引脚触发 GPIO 中断，支持实现硬件级手势检测触发，连接 RTC GPIO 可实现 deepsleep 手势唤醒
- **实时处理**：低延迟手势识别响应
- **桌面优化**：专门针对桌面前推检测的配置

## 硬件要求

- ESP32 开发板：
  - ESP-SPOT-C5
  - ESP-SPOT-S3
  - ESP-ASTOM-S3
  - ESP-ECHOEAR-S3
  - 自定义开发板
- BMI270 传感器

## 配置说明

### Menuconfig 配置

1. **开发板选择**：
   ```
   Component config -> BMI270 Sensor -> Board Selection
   ```
   选择对应的开发板型号

2. **自定义引脚配置**：
   ```
   Component config -> BMI270 Sensor -> Custom Pin Configuration
   ```
   配置 I2C 和中断引脚：
   - I2C SCL Pin
   - I2C SDA Pin
   - INT Pin

### 代码配置

以下参数可在 `push_on_table_main.c` 中调整：

```c
// 推压检测灵敏度的高G阈值（针对桌面表面优化）
uint16_t high_g_threshold = 0x0800;  // 默认阈值

// 加速度计配置
config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_200HZ;    // 200Hz 采样率
config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_16G;  // ±16G 量程
config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // 带宽参数
config[BMI2_ACCEL].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE; // 滤波器性能

// 陀螺仪配置
config[BMI2_GYRO].cfg.gyr.odr = BMI2_GYR_ODR_200HZ;     // 200Hz 采样率
config[BMI2_GYRO].cfg.gyr.range = BMI2_GYR_RANGE_2000;   // ±2000dps 量程
config[BMI2_GYRO].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;   // 带宽参数
config[BMI2_GYRO].cfg.gyr.noise_perf = BMI2_POWER_OPT_MODE; // 噪声性能
config[BMI2_GYRO].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE; // 滤波器性能
```

#### 配置函数

该示例包含两个专门针对桌面表面优化的函数：

**1. `adjust_high_g_threshold_for_on_table()`**
- **作用**：针对桌面表面检测优化高G阈值
- **功能**：设置高G阈值为 0x0800 以获得更敏感的检测
- **使用**：在初始化时调用以配置灵敏度
- **寄存器**：修改寄存器 0x30 的阈值值

**2. `adjust_high_g_axis_by_rolling()`**
- **作用**：根据滚动运动动态调整高G轴选择
- **功能**：分析滚动数据以确定最佳轴配置
- **使用**：检测到滚动中断时调用
- **逻辑**：
  - 从寄存器 0x1e 读取滚动轴数据
  - 临时禁用高G和推压功能
  - 更新寄存器 0x32 中的轴选择
  - 使用新轴配置重新启用功能

#### 可调参数

您可以根据不同的灵敏度需求修改这些函数：

```c
// 在 adjust_high_g_threshold_for_on_table() 中
uint16_t high_g_threshold = 0x0800;  // 调整灵敏度（更低 = 更敏感）

// 在 adjust_high_g_axis_by_rolling() 中
uint8_t select_x = 1;  // 启用/禁用 X 轴检测
uint8_t select_y = 1;  // 启用/禁用 Y 轴检测
uint8_t select_z = 1;  // 启用/禁用 Z 轴检测
```

## 使用方法

1. **编译和烧录**：
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **运行测试**：
   - 将传感器放置在桌面表面
   - 在桌面上进行推压手势
   - 观察串口输出中的检测结果
   - 根据实际需要调整灵敏度

## 输出示例

```
I (1378) bmi270_api: BMI270 sensor created successfully
I (1388) MAIN: Push feature enabled, result: 0
I (1488) MAIN: Move the sensor to get push interrupt...
I (6198) MAIN: Push generated!
I (6198) MAIN: Push direction: +x
I (6198) MAIN: Waiting 3 seconds before next detection...
I (9198) MAIN: Ready for next push detection...
I (11008) MAIN: Push generated!
I (11008) MAIN: Push direction: -y
I (11008) MAIN: Waiting 3 seconds before next detection...
```