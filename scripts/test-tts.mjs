#!/usr/bin/env node
/**
 * Test script for Qwen TTS API via Alibaba Cloud DashScope
 *
 * Usage:
 *   node scripts/test-tts.mjs "测试文本"
 *
 * Or with explicit API key:
 *   node scripts/test-tts.mjs "测试文本" --api-key YOUR_API_KEY
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Parse arguments
const args = process.argv.slice(2);
let text = '';
let apiKey = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--api-key' && i + 1 < args.length) {
    apiKey = args[i + 1];
    i++;
  } else if (!args[i].startsWith('--')) {
    text = args[i];
  }
}

if (!text) {
  text = '你好，这是一个语音合成测试。';
}

// Get API key from env if not provided
if (!apiKey) {
  apiKey = process.env.DASHSCOPE_API_KEY || '';
}

if (!apiKey) {
  console.error('Error: DASHSCOPE_API_KEY not set');
  console.error('');
  console.error('Please either:');
  console.error('  1. Set DASHSCOPE_API_KEY in .env file');
  console.error('  2. Pass --api-key argument');
  console.error('');
  console.error('Get your API key from: https://dashscope.console.aliyun.com/');
  process.exit(1);
}

console.log('Testing Qwen TTS API...');
console.log(`Text: "${text}"`);
console.log(`API Key: ${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`);

async function testTts() {
  const apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts';

  const requestBody = {
    model: 'qwen-tts',
    input: {
      text: text.trim()
    },
    parameters: {
      voice: 'cherry',
      format: 'wav',  // Use WAV for easier testing
      sample_rate: 16000
    }
  };

  console.log('\nSending request to DashScope...');

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error: ${response.status}`);
      console.error(`Response: ${errorText}`);
      process.exit(1);
    }

    // Handle SSE streaming response
    const contentType = response.headers.get('content-type');
    console.log(`Content-Type: ${contentType}`);

    const audioChunks = [];

    if (contentType?.includes('text/event-stream') || contentType?.includes('multipart')) {
      console.log('\nParsing SSE stream...');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            if (jsonStr === '[DONE]') {
              console.log('Stream completed');
              continue;
            }
            try {
              const chunk = JSON.parse(jsonStr);
              if (chunk.output?.audio) {
                audioChunks.push(Buffer.from(chunk.output.audio, 'base64'));
                console.log(`Received chunk: ${audioChunks[audioChunks.length - 1].length} bytes`);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } else {
      // Non-streaming response
      const data = await response.json();
      if (data.output?.audio) {
        audioChunks.push(Buffer.from(data.output.audio, 'base64'));
      }
    }

    if (audioChunks.length === 0) {
      console.error('No audio data received');
      process.exit(1);
    }

    // Combine all chunks
    const audioBuffer = Buffer.concat(audioChunks);
    console.log(`\nTotal audio size: ${audioBuffer.length} bytes`);

    // Save to file
    const outputPath = path.join(process.cwd(), 'tmp', 'tts-test.wav');
    const tmpDir = path.dirname(outputPath);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, audioBuffer);

    console.log(`\nAudio saved to: ${outputPath}`);
    console.log('You can play it with any audio player');

    // Success!
    console.log('\n✓ TTS API test successful!');
    process.exit(0);

  } catch (error) {
    console.error(`\n✗ TTS test failed: ${error.message}`);
    process.exit(1);
  }
}

testTts();