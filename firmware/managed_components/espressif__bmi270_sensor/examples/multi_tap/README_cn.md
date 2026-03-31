# BMI270 三击检测示例

## 概述

本示例演示了如何使用 BMI270 传感器进行三击检测。

## 功能特点

- **三击检测**：使用 BMI270 检测三击手势
- **低功耗**：BMI270 INT 引脚触发 GPIO 中断进行硬件级三击检测，连接 RTC GPIO 可实现深度睡眠三击唤醒
- **实时处理**：低延迟的三击识别响应

## 硬件要求

- ESP32 开发板（ESP32-S3、ESP32-C5 等）
- BMI270 传感器

## 输出示例

当检测到三击时，您应该看到如下输出：

```
I (1378) bmi270_api: BMI270 sensor created successfully
I (1388) MAIN: Tap feature enabled, result: 0
I (1488) MAIN: Tap the sensor to get tap interrupt...
I (6198) MAIN: Interrupt detected!
I (6198) MAIN: Tap interrupt detected!
I (6198) MAIN: Triple Tap Detected!
I (6198) MAIN: Waiting 3 seconds before next detection...
I (9198) MAIN: Ready for next tap detection...
I (11008) MAIN: Interrupt detected!
I (11008) MAIN: Tap interrupt detected!
I (11008) MAIN: Other tap detected (not triple)
I (11008) MAIN: Waiting 3 seconds before next detection...
I (14018) MAIN: Ready for next tap detection...
```
