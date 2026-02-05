const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const ico = require('png-to-ico').default
const { execSync } = require('child_process')

// 配置
const config = {
  inputSvg: path.join(__dirname, '../resources/logo.svg'),
  traySvg: path.join(__dirname, '../resources/tray-logo.svg'),
  outputDir: path.join(__dirname, '../resources'),
  buildDir: path.join(__dirname, '../build'),
  standardSize: 256,
  icoSizes: [16, 32, 48, 256],
  icnsSizes: [16, 32, 64, 128, 256, 512, 1024]
}

async function generateIcons() {
  console.log('🎨 开始生成 Coobee AI Logo 图标...')

  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true })
  }

  if (!fs.existsSync(config.inputSvg)) {
    console.error(`❌ SVG 文件不存在: ${config.inputSvg}`)
    return
  }

  await generateAppIcon()
  await generateTrayIcon()
  await generateMacIcns()

  console.log('✅ 图标生成完成!')
  console.log('\n📁 生成的文件:')
  console.log('\n   Resources 目录 (运行时使用):')
  console.log('   - logo.png (应用图标，256x256)')
  console.log('   - logo.ico (Windows 应用图标)')
  console.log('   - tray-logo.png (托盘图标，22x22)')
  console.log('   - tray-logo@2x.png (托盘图标 Retina，44x44)')
  console.log('\n   Build 目录 (electron-builder 打包使用):')
  console.log('   - icon.icns (macOS 应用图标，多分辨率)')
  console.log('   - icon.png (通用应用图标)')
  console.log('   - icon.ico (Windows 应用图标)')
}

async function generateAppIcon() {
  console.log('\n🔧 生成应用图标...')

  const svgBuffer = fs.readFileSync(config.inputSvg)

  // 生成主 PNG 图标
  console.log(`   📱 生成 logo.png (${config.standardSize}x${config.standardSize})...`)
  const mainPngBuffer = await sharp(svgBuffer)
    .resize(config.standardSize, config.standardSize, {
      kernel: sharp.kernel.lanczos3,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ quality: 100 })
    .toBuffer()

  fs.writeFileSync(path.join(config.outputDir, 'logo.png'), mainPngBuffer)

  // 生成 Windows ICO 图标
  console.log('   🪟 生成 logo.ico...')
  const pngBuffers = []

  for (const size of config.icoSizes) {
    const pngBuffer = await sharp(svgBuffer)
      .resize(size, size, {
        kernel: sharp.kernel.lanczos3,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ quality: 100 })
      .toBuffer()

    pngBuffers.push(pngBuffer)
  }

  const icoBuffer = await ico(pngBuffers)
  fs.writeFileSync(path.join(config.outputDir, 'logo.ico'), icoBuffer)

  // 复制到 build 目录（electron-builder 需要 icon.* 命名）
  console.log('   📋 复制到 build 目录...')
  if (!fs.existsSync(config.buildDir)) {
    fs.mkdirSync(config.buildDir, { recursive: true })
  }
  fs.copyFileSync(path.join(config.outputDir, 'logo.png'), path.join(config.buildDir, 'icon.png'))
  fs.copyFileSync(path.join(config.outputDir, 'logo.ico'), path.join(config.buildDir, 'icon.ico'))
  console.log('   ✅ build/icon.png')
  console.log('   ✅ build/icon.ico')
}

async function generateTrayIcon() {
  console.log('\n🔧 生成托盘图标...')

  if (!fs.existsSync(config.traySvg)) {
    console.warn('   ⚠️  托盘图标 SVG 不存在，跳过')
    return
  }

  const svgBuffer = fs.readFileSync(config.traySvg)

  // macOS 标准分辨率
  console.log('   🍎 生成 tray-logo.png (22x22)...')
  const macStandardBuffer = await sharp(svgBuffer)
    .resize(22, 22, {
      kernel: sharp.kernel.lanczos3,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ quality: 100 })
    .toBuffer()

  fs.writeFileSync(path.join(config.outputDir, 'tray-logo.png'), macStandardBuffer)

  // macOS Retina 分辨率
  console.log('   🍎 生成 tray-logo@2x.png (44x44)...')
  const macRetinaBuffer = await sharp(svgBuffer)
    .resize(44, 44, {
      kernel: sharp.kernel.lanczos3,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ quality: 100 })
    .toBuffer()

  fs.writeFileSync(path.join(config.outputDir, 'tray-logo@2x.png'), macRetinaBuffer)
  console.log('   ✅ 托盘图标已生成（支持 macOS 明暗主题）')
}

async function generateMacIcns() {
  console.log('\n🔧 生成 macOS .icns 图标...')

  if (!fs.existsSync(config.buildDir)) {
    fs.mkdirSync(config.buildDir, { recursive: true })
  }

  const iconsetDir = path.join(config.buildDir, 'icon.iconset')
  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir, { recursive: true })
  } else {
    const files = fs.readdirSync(iconsetDir)
    files.forEach((file) => fs.unlinkSync(path.join(iconsetDir, file)))
  }

  const svgBuffer = fs.readFileSync(config.inputSvg)

  const iconsetSizes = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' }
  ]

  console.log('   📱 生成 iconset PNG 文件...')
  for (const { size, name } of iconsetSizes) {
    const pngBuffer = await sharp(svgBuffer)
      .resize(size, size, {
        kernel: sharp.kernel.lanczos3,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ quality: 100 })
      .toBuffer()

    fs.writeFileSync(path.join(iconsetDir, name), pngBuffer)
  }

  if (process.platform === 'darwin') {
    try {
      console.log('   🍎 转换为 .icns 文件...')
      const icnsPath = path.join(config.buildDir, 'icon.icns')
      execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`)
      console.log(`   ✅ 已生成: ${icnsPath}`)

      fs.rmSync(iconsetDir, { recursive: true, force: true })
    } catch (error) {
      console.error('   ⚠️  转换 icns 失败:', error.message)
      console.log('   💡 提示: iconset 文件已生成在 build/icon.iconset/')
      console.log('   💡 您可以手动运行: iconutil -c icns build/icon.iconset -o build/icon.icns')
    }
  } else {
    console.log('   ⚠️  非 macOS 系统，跳过 .icns 转换')
    console.log('   💡 iconset 文件已生成在 build/icon.iconset/')
    console.log('   💡 在 macOS 上运行此脚本以生成 .icns 文件')
  }
}

if (require.main === module) {
  generateIcons().catch(console.error)
}

module.exports = { generateIcons }
