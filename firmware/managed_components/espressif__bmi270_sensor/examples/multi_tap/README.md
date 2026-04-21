# BMI270 Triple Tap Detection Example

## Overview

This example demonstrates how to use the BMI270 sensor for triple tap detection.

## Features

- **Triple Tap Detection**: Uses BMI270 to detect triple tap gestures
- **Low Power**: BMI270 INT pin triggers GPIO interrupt for hardware-level triple tap detection, connecting to RTC GPIO enables deep sleep triple tap wake-up
- **Real-time Processing**: Low-latency triple tap recognition response

## Hardware Requirements

- ESP32 development board (ESP32-S3, ESP32-C5, etc.)
- BMI270 sensor

## Output Example

When triple tap is detected, you should see the following output:

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