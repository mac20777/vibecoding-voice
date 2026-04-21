# BMI270 Orientation Detection Example

## Overview

This example demonstrates how to use the BMI270 sensor for orientation detection. The sensor can detect the absolute orientation of the device along X, Y, Z axes, and by comparing the current state with the previous state, you can determine which axis the device is rolling around.

## Features

- **Orientation Detection**: Detects absolute orientation along X, Y, Z axes (6 directions: upside/downside for each axis)
- **Rolling Analysis**: By comparing orientation changes, determines which axis the device is rolling around
- **Interrupt-based**: Uses GPIO interrupts for efficient detection
- **Toy Firmware**: Uses BMI270 toy firmware for enhanced motion detection capabilities

## Hardware Requirements

- ESP32 development board
- BMI270 sensor connected via I2C
- GPIO pin for interrupt connection

### Accelerometer Configuration
- **ODR**: 200Hz (Output Data Rate)
- **Range**: ±16G (Measurement range)
- **Bandwidth**: Normal averaging 4 samples
- **Filter Performance**: High performance mode

### Gyroscope Configuration
- **ODR**: 200Hz (Output Data Rate)
- **Range**: ±2000dps (Angular rate range)
- **Bandwidth**: Normal mode
- **Noise Performance**: Power optimized mode
- **Filter Performance**: High performance mode

### Interrupt Configuration
- **Pin**: INT1
- **Level**: Active Low
- **Output**: Push-pull
- **Latch**: Enabled

## Orientation Detection Directions

The sensor can detect absolute orientation in 6 different directions:

1. **X upside** - Device oriented with X-axis pointing up
2. **X downside** - Device oriented with X-axis pointing down
3. **Y upside** - Device oriented with Y-axis pointing up
4. **Y downside** - Device oriented with Y-axis pointing down
5. **Z upside** - Device oriented with Z-axis pointing up
6. **Z downside** - Device oriented with Z-axis pointing down

## Rolling Analysis

By comparing consecutive orientation states, you can determine rolling behavior:
- **X-axis rolling**: Changes between X upside/downside
- **Y-axis rolling**: Changes between Y upside/downside  
- **Z-axis rolling**: Changes between Z upside/downside
- **Complex rolling**: Multiple axis changes in sequence

## Usage

1. Connect the BMI270 sensor to your ESP32 board according to the pin configuration
2. Build and flash the example
3. Rotate the sensor to different orientations
4. The example will detect orientation changes and display the current absolute orientation

## Output Example

When orientation changes are detected, you should see the following output:

```
I (1637) bmi270_api: BMI270 sensor created successfully
I (1647) MAIN: Rolling feature enabled, result: 0
I (1747) MAIN: Move the sensor to get rolling interrupt...
I (9277) MAIN: 🔄 Rolling: X downside
I (9277) MAIN:    |
I (9277) MAIN:    ↓
I (10537) MAIN: 🔄 Rolling: Z upside
I (10537) MAIN:    ↻
I (11727) MAIN: 🔄 Rolling: Y downside
I (11727) MAIN:    ——→
I (13047) MAIN: 🔄 Rolling: Z upside
I (13047) MAIN:    ↻
I (14147) MAIN: 🔄 Rolling: Y upside
I (14147) MAIN:    ←——
I (15267) MAIN: 🔄 Rolling: Z upside
I (15267) MAIN:    ↻
I (16387) MAIN: 🔄 Rolling: X upside
I (16387) MAIN:    ↑
I (16387) MAIN:    |
I (17587) MAIN: 🔄 Rolling: Z upside
I (17587) MAIN:    ↻
```

## API Functions

### Main Functions
- `bmi270_sensor_create()` - Initialize BMI270 sensor
- `bmi270_enable_rolling_int()` - Enable rolling detection interrupt
- `bmi270_sensor_del()` - Clean up sensor resources

### Configuration Functions
- `set_feature_config()` - Configure accelerometer and gyroscope parameters
- `bmi270_toy_enable_rolling()` - Enable rolling feature in toy firmware

## Troubleshooting

1. **No rolling detection**: Check I2C connections and sensor power
2. **Incorrect direction**: Verify sensor orientation and mounting
3. **Interrupt not working**: Check GPIO configuration and interrupt pin connection

## Notes

- The example uses a 3-second delay between detections to prevent false triggers
- Rolling detection requires both accelerometer and gyroscope data
- The sensor must be properly mounted and oriented for accurate detection
