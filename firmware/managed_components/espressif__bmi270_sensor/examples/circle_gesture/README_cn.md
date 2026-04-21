# BMI270 Circle 手势识别示例

## 概述

本例演示了如何使用 BMI270 传感器进行画圈手势识别。

## 功能特点

- **多轴检测**：支持 X、Y、Z 三旋转轴
- **低功耗**：BMI270 INT 引脚触发 GPIO 中断，支持实现硬件级手势检测触发，连接 RTC GPIO 可实现 deepsleep 手势唤醒
- **实时处理**：低延迟的手势识别响应

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
   配置 I2C 引脚：
   - I2C SCL Pin
   - I2C SDA Pin
   - INT Pin

### 代码配置

在 `circle_gesture_main.c` 中可以调整以下参数：

```c
// 加速度计采样率配置
config[1].cfg.acc.odr = BMI2_ACC_ODR_50HZ; // 50Hz采样率

// 旋转轴配置使用预定义宏
// BMI2_AXIS_SELECTION_X -> X轴 (绕X轴圆形手势)
// BMI2_AXIS_SELECTION_Y -> Y轴 (绕Y轴圆形手势)  
// BMI2_AXIS_SELECTION_Z -> Z轴 (绕Z轴圆形手势)
struct bmi2_circle_gest_det_config *circle_cfg = (struct bmi2_circle_gest_det_config *)&config[0].cfg;
circle_cfg->cgd_cfg1.axis_of_rotation = BMI2_AXIS_SELECTION_Z;

// 其他可调参数
config[1].cfg.acc.range = BMI2_ACC_RANGE_2G;  // 加速度计量程
config[1].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // 带宽参数
```

## 使用方法

1. **编译和烧录**：
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **运行测试**：
   - 握住传感器进行圆形手势
   - 观察串口输出的检测结果
   - 根据实际需求调整敏感度

## 输出示例

```
I (1409) MAIN: Move the board in circular motion
I (44409) MAIN: Circle Gesture Detected!
I (44409) MAIN: Clockwise direction
I (44409) MAIN: Waiting 3 seconds before next detection...
I (47409) MAIN: Ready for next circle gesture detection...
I (68709) MAIN: Circle Gesture Detected!
I (68709) MAIN: Clockwise direction
```
