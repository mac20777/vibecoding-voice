# BMI270 Rotation Angle Detection Example

## Overview

This example demonstrates how to use the BMI270 sensor for rotation angle detection. The sensor can measure the rotation angle of the device and provide real-time angle measurements.

## Features

- **Rotation Angle Detection**: Measures rotation angle in 0.01 degree units
- **Real-time Monitoring**: Continuous angle measurement with 100ms polling

## Hardware Requirements

- ESP32 development board
- BMI270 sensor connected via I2C
- GPIO pin for interrupt connection

### Accelerometer Configuration
- **ODR**: 200Hz (Output Data Rate)
- **Range**: ±16g
- **BWP**: Normal averaging with 4 samples
- **Filter Performance**: Optimized mode

### Gyroscope Configuration
- **ODR**: 200Hz (Output Data Rate)
- **Range**: ±2000 dps
- **BWP**: Normal mode
- **Noise Performance**: Power optimized mode
- **Filter Performance**: Optimized mode

### Rotation Parameters
- **Static Threshold**: 0x0014 (default, sensitive for table placement)
- **Robust Threshold**: 0x0080 (for hand-held applications)

## Usage

1. Connect the BMI270 sensor to your ESP32 board according to the pin configuration
2. Build and flash the example
3. Rotate the sensor to different angles
4. The example will continuously measure and display the rotation angle

## Output Example

When rotation angles are detected, you should see the following output:

```
I (1637) bmi270_api: BMI270 sensor created successfully
I (1647) MAIN: Rotation feature enabled, result: 0
I (1747) MAIN: Rotate the sensor to get rotation angle...
I (1847) MAIN: Please keep static for a while...
```

### Real-time Rotation Detection

Here's an example of continuous rotation angle detection showing the sensor's ability to track smooth rotation movements, suitable for applications like hand-held dimmers:

```
I (11837) MAIN:    ↻ -37.39°
I (11937) MAIN:    ↻ -33.87°
I (12037) MAIN:    ↻ -31.26°
I (12137) MAIN:    ↻ -28.50°
I (12237) MAIN:    ↻ -26.10°
I (12337) MAIN:    ↻ -24.92°
I (12437) MAIN:    ↻ -23.31°
I (12537) MAIN:    ↻ -21.21°
I (12637) MAIN:    ↻ -18.70°
I (12737) MAIN:    ↻ -16.56°
I (12837) MAIN:    ↻ -14.18°
I (12937) MAIN:    ↻ -10.74°
I (13037) MAIN:    ↻ -8.38°
I (13137) MAIN:    ↻ -7.22°
I (13237) MAIN:    ↻ -5.98°
I (13337) MAIN:    ↻ -2.67°
I (13437) MAIN:    ↻ -0.51°
I (13537) MAIN:    ↺ +0.41°
I (13637) MAIN:    ↺ +3.84°
I (13737) MAIN:    ↺ +5.09°
I (13837) MAIN:    ↺ +5.69°
I (13937) MAIN:    ↺ +7.08°
```

## Configuration Functions

### `adjust_rotation_parameter()`
Configures the static threshold for rotation detection:
- **Default threshold (0x0014)**: Sensitive for table placement
- **Robust threshold (0x0080)**: For hand-held applications
- **Static detection**: Ensures device is stationary before angle measurement

### `set_accel_gyro_config()`
Configures accelerometer and gyroscope parameters:
- **High ODR**: 200Hz for responsive angle detection
- **Wide range**: ±16g accelerometer, ±2000 dps gyroscope
- **Optimized filtering**: Balance between performance and power consumption

## Notes

- The rotation angle detection is based on polling (100ms intervals), not interrupts
- The sensor needs to be relatively static for accurate angle measurement
- The example uses the toy firmware which provides enhanced rotation detection capabilities
- Angle measurements are in degrees with 2 decimal precision