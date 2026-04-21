# BMI270 Circle Gesture Recognition Example

## Overview

This example demonstrates how to use the BMI270 sensor for circle gesture detection.

## Features

- **Multi-axis Detection**: Supports X, Y, Z three rotation axes
- **Low Power**: BMI270 INT pin triggers GPIO interrupt for hardware-level gesture detection, connecting to RTC GPIO enables deep sleep gesture wake-up
- **Real-time Processing**: Low-latency gesture recognition response

## Hardware Requirements

- ESP32 development board:
  - ESP-SPOT-C5
  - ESP-SPOT-S3
  - ESP-ASTOM-S3
  - ESP-ECHOEAR-S3
  - Custom development board
- BMI270 sensor

## Configuration

### Menuconfig Configuration

1. **Board Selection**:
   ```
   Component config -> BMI270 Sensor -> Board Selection
   ```
   Select the corresponding development board model

2. **Custom Pin Configuration**:
   ```
   Component config -> BMI270 Sensor -> Custom Pin Configuration
   ```
   Configure I2C pins:
   - I2C SCL Pin
   - I2C SDA Pin
   - INT Pin

### Code Configuration

The following parameters can be adjusted in `circle_gesture_main.c`:

```c
// Accelerometer sampling rate configuration
config[1].cfg.acc.odr = BMI2_ACC_ODR_50HZ; // 50Hz sampling rate

// Rotation axis configuration using predefined macros
// BMI2_AXIS_SELECTION_X -> X-axis (circular gesture around X-axis)
// BMI2_AXIS_SELECTION_Y -> Y-axis (circular gesture around Y-axis)  
// BMI2_AXIS_SELECTION_Z -> Z-axis (circular gesture around Z-axis)
struct bmi2_circle_gest_det_config *circle_cfg = (struct bmi2_circle_gest_det_config *)&config[0].cfg;
circle_cfg->cgd_cfg1.axis_of_rotation = BMI2_AXIS_SELECTION_Z;

// Other adjustable parameters
config[1].cfg.acc.range = BMI2_ACC_RANGE_2G;  // Accelerometer range
config[1].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // Bandwidth parameter
```

## Usage

1. **Build and Flash**:
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **Run Test**:
   - Hold the sensor and perform circular gestures
   - Observe the detection results in serial output
   - Adjust sensitivity according to actual needs

## Output Example

```
I (1409) MAIN: Move the board in circular motion
I (44409) MAIN: Circle Gesture Detected!
I (44409) MAIN: Clockwise direction
I (44409) MAIN: Waiting 3 seconds before next detection...
I (47409) MAIN: Ready for next circle gesture detection...
I (68709) MAIN: Circle Gesture Detected!
I (68709) MAIN: Clockwise direction
```
