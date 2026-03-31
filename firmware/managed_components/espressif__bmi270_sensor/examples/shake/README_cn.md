# BMI270 摇晃检测示例

## 概述

本示例演示了如何使用 BMI270 传感器进行摇晃检测。

## 功能特点

- **摇晃检测**：使用 BMI270 检测摇晃手势
- **低功耗**：BMI270 INT 引脚触发 GPIO 中断进行硬件级摇晃检测，连接 RTC GPIO 可实现深度睡眠摇晃唤醒
- **实时处理**：低延迟的摇晃识别响应

## 硬件要求

- ESP32 开发板（ESP32-S3、ESP32-C5 等）
- BMI270 传感器

## 输出示例

当检测到轻度/稍重摇晃时，您应该看到如下输出：

```
I (1378) bmi270_api: BMI270 sensor created successfully
I (1388) MAIN: Shake feature enabled, result: 0
I (1388) MAIN: Move the sensor to get shake interrupt...
I (3788) MAIN: Slight shake on: 
I (3788) MAIN: X axis
I (5888) MAIN: Slight shake on: 
I (5888) MAIN: Z axis
I (8588) MAIN: Heavy shake on: 
I (8588) MAIN: Y axis
```