/**
 * 敏感文件迁移脚本
 *
 * 将 secrets.json5 和 skills.json5 从 config/ 目录迁移到独立的 secrets/ 目录
 *
 * 使用场景：
 *   - 首次升级到新版本（目录隔离架构）
 *   - 从 .home/config/ 迁移到 .home/secrets/
 *   - 从 ~/.coobee-ai/config/ 迁移到 ~/.coobee-ai/secrets/
 *
 * 执行：
 *   pnpm tsx scripts/migrate-secrets.ts
 */

import fs from 'fs';
import path from 'path';

interface MigrationResult {
  success: boolean;
  message: string;
  details?: {
    secretsFrom?: string;
    secretsTo?: string;
    skillsFrom?: string;
    skillsTo?: string;
  };
}

const DEV_BASE = path.join(process.cwd(), '.home');
const PROD_BASE = path.join(process.env.HOME || '~', '.coobee-ai');

function migrateFiles(baseDir: string, env: 'dev' | 'prod'): MigrationResult {
  const configDir = path.join(baseDir, 'config');
  const secretsDir = path.join(baseDir, 'secrets');

  const secretsOld = path.join(configDir, 'secrets.json5');
  const secretsNew = path.join(secretsDir, 'secrets.json5');
  const skillsOld = path.join(configDir, 'skills.json5');
  const skillsNew = path.join(secretsDir, 'skills.json5');

  // 检查是否已迁移
  if (fs.existsSync(secretsNew) && fs.existsSync(skillsNew)) {
    return {
      success: true,
      message: `[${env}] 已迁移过，无需重复操作`
    };
  }

  // 检查旧文件是否存在
  const secretsExists = fs.existsSync(secretsOld);
  const skillsExists = fs.existsSync(skillsOld);

  if (!secretsExists && !skillsExists) {
    return {
      success: true,
      message: `[${env}] 未找到旧文件，可能是全新安装`
    };
  }

  // 创建 secrets/ 目录（700 权限）
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  } else {
    fs.chmodSync(secretsDir, 0o700);
  }

  const details: MigrationResult['details'] = {};

  // 迁移 secrets.json5
  if (secretsExists && !fs.existsSync(secretsNew)) {
    fs.copyFileSync(secretsOld, secretsNew);
    fs.chmodSync(secretsNew, 0o600);
    fs.unlinkSync(secretsOld);
    details.secretsFrom = secretsOld;
    details.secretsTo = secretsNew;
  }

  // 迁移 skills.json5
  if (skillsExists && !fs.existsSync(skillsNew)) {
    fs.copyFileSync(skillsOld, skillsNew);
    fs.chmodSync(skillsNew, 0o600);
    fs.unlinkSync(skillsOld);
    details.skillsFrom = skillsOld;
    details.skillsTo = skillsNew;
  }

  return {
    success: true,
    message: `[${env}] 迁移成功`,
    details
  };
}

function main() {
  console.log('========== 敏感文件迁移脚本 ==========\n');

  // 开发环境迁移
  if (fs.existsSync(DEV_BASE)) {
    const devResult = migrateFiles(DEV_BASE, 'dev');
    console.log(devResult.message);
    if (devResult.details) {
      if (devResult.details.secretsFrom) {
        console.log(`  ✅ secrets.json5: ${devResult.details.secretsFrom} → ${devResult.details.secretsTo}`);
      }
      if (devResult.details.skillsFrom) {
        console.log(`  ✅ skills.json5: ${devResult.details.skillsFrom} → ${devResult.details.skillsTo}`);
      }
    }
  } else {
    console.log('[dev] 未找到 .home/ 目录，跳过');
  }

  console.log();

  // 生产环境迁移
  if (fs.existsSync(PROD_BASE)) {
    const prodResult = migrateFiles(PROD_BASE, 'prod');
    console.log(prodResult.message);
    if (prodResult.details) {
      if (prodResult.details.secretsFrom) {
        console.log(`  ✅ secrets.json5: ${prodResult.details.secretsFrom} → ${prodResult.details.secretsTo}`);
      }
      if (prodResult.details.skillsFrom) {
        console.log(`  ✅ skills.json5: ${prodResult.details.skillsFrom} → ${prodResult.details.skillsTo}`);
      }
    }
  } else {
    console.log('[prod] 未找到 ~/.coobee-ai/ 目录，跳过');
  }

  console.log('\n========================================');
}

main();
