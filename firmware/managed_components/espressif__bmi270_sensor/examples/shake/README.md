# BMI270 Shake Detection Example

## Overview

This example demonstrates how to use the BMI270 sensor for shake detection.

## Features

- **Shake Detection**: Uses BMI270 to detect shake gestures
- **Low Power**: BMI270 INT pin triggers GPIO interrupt for hardware-level shake detection, connecting to RTC GPIO enables deep sleep shake wake-up
- **Real-time Processing**: Low-latency shake recognition response

## Hardware Requirements

- ESP32 development board (ESP32-S3, ESP32-C5, etc.)
- BMI270 sensor

## Output Example

When slight/heavy shake is detected, you should see the following output:

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