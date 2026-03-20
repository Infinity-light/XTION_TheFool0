#!/usr/bin/env node

/**
 * 生成多个 API Key 的脚本
 * 使用方式: node generate-keys.js <数量> [基础名称]
 * 例如: node generate-keys.js 5 Agent
 */

const http = require('http');

const count = parseInt(process.argv[2]) || 3;
const baseName = process.argv[3] || 'Agent';
const apiUrl = 'http://localhost:3000/api/admin/keys';

async function generateKey(name) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ name });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/admin/keys',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 201) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log(`\n🔑 生成 ${count} 个 API Key...\n`);

  const keys = [];
  for (let i = 1; i <= count; i++) {
    try {
      const name = `${baseName}${i}`;
      const key = await generateKey(name);
      keys.push(key);
      console.log(`✓ ${name}`);
      console.log(`  Key: ${key.key}`);
      console.log(`  ID:  ${key.id}\n`);
    } catch (err) {
      console.error(`✗ 生成失败: ${err.message}\n`);
    }
  }

  console.log('\n📋 所有 Key 汇总:\n');
  keys.forEach((key, idx) => {
    console.log(`${idx + 1}. ${key.contestantName}`);
    console.log(`   Key: ${key.key}`);
  });

  console.log('\n✅ 完成！\n');
}

main().catch(console.error);
