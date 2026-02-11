const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const apiDir = path.join(__dirname, '../src/main/api')
const outputFilePath = path.join(__dirname, '../src/renderer/src/api/backend-api.ts')

function toKebabCase(str) {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase()
}

function findTsFiles(directory) {
  let tsFiles = []
  const files = fs.readdirSync(directory)

  for (const file of files) {
    const filePath = path.join(directory, file)
    const stat = fs.statSync(filePath)

    if (stat.isDirectory()) {
      tsFiles = tsFiles.concat(findTsFiles(filePath))
    } else if (stat.isFile() && file.endsWith('.ts')) {
      tsFiles.push(filePath)
    }
  }
  return tsFiles
}

function generateChannelBase(filePath) {
  const relativePath = path.relative(apiDir, filePath)
  const baseName = relativePath.replace(/\.ts$/, '')
  const parts = baseName.split(/[\\/]/)
  const channelParts = ['api', ...parts].map(toKebabCase)
  return '/' + channelParts.join('/')
}

function generateClientObjectPath(filePath) {
  const relativePath = path.relative(apiDir, filePath)
  const baseName = relativePath.replace(/\.ts$/, '')
  const parts = baseName.split(/[\\/]/).filter((part) => part)
  return parts
}

function getDecoratorType(fileContent, functionName) {
  const functionRegex = new RegExp(
    `(@\\w+\\s*\\([^)]*\\)\\s*)*\\s*(?:export\\s+)?(?:async\\s+\\*?\\s*)?(?:function\\s+)?${functionName}\\s*\\(`,
    'gm'
  )
  const match = functionRegex.exec(fileContent)

  if (match && match[0]) {
    if (match[0].includes('@Stream')) {
      return 'Stream'
    }
    if (match[0].includes('@SSE')) {
      return 'SSE'
    }
  }

  return 'SSE'
}

function parseFileExports(fileContent) {
  const exports = {
    functions: [],
    sseFunctions: [],
    streamFunctions: [],
    hasDefaultClass: false
  }

  const functionMatches = fileContent.matchAll(
    /^export\s+(?:(async\s+\*?)\s*)?function\s+(\w+)\s*\(/gm
  )
  for (const match of functionMatches) {
    const asyncPart = match[1] || ''
    const functionName = match[2]
    const isGenerator = asyncPart.includes('*')

    if (isGenerator) {
      const decoratorType = getDecoratorType(fileContent, functionName)
      if (decoratorType === 'Stream') {
        exports.streamFunctions.push(functionName)
      } else {
        exports.sseFunctions.push(functionName)
      }
    } else {
      exports.functions.push(functionName)
    }
  }

  const classMatch = fileContent.match(/^export\s+default\s+class\s+(\w+)/m)
  if (classMatch) {
    exports.hasDefaultClass = true

    const decoratorPattern = /@(Post|Get|Put|Delete|SSE|Stream)\s*\([^)]*\)/g
    let decoratorMatch
    while ((decoratorMatch = decoratorPattern.exec(fileContent)) !== null) {
      const decoratorType = decoratorMatch[1]
      const decoratorEnd = decoratorMatch.index + decoratorMatch[0].length

      const afterDecorator = fileContent.slice(decoratorEnd)
      const methodMatch = afterDecorator.match(/^\s*(?:(async\s+\*?)\s*)?(\w+)\s*\(/)

      if (methodMatch) {
        const asyncPart = methodMatch[1] || ''
        const methodName = methodMatch[2]
        const isGenerator = asyncPart.includes('*')

        const reservedKeywords = [
          'if',
          'while',
          'for',
          'switch',
          'try',
          'catch',
          'finally',
          'return',
          'break',
          'continue'
        ]
        if (
          methodName !== 'constructor' &&
          !methodName.startsWith('_') &&
          !reservedKeywords.includes(methodName)
        ) {
          if (isGenerator) {
            if (decoratorType === 'Stream') {
              exports.streamFunctions.push(methodName)
            } else {
              exports.sseFunctions.push(methodName)
            }
          } else {
            exports.functions.push(methodName)
          }
        }
      }
    }
  }

  return exports
}

async function generateApiClient() {
  if (!fs.existsSync(apiDir)) {
    return
  }

  const tsFiles = findTsFiles(apiDir)

  const apiStructure = {}

  // Track which imports are actually used
  const usedImports = new Set()

  for (const filePath of tsFiles) {
    const channelBase = generateChannelBase(filePath)
    const objectPathParts = generateClientObjectPath(filePath)

    const fileContent = fs.readFileSync(filePath, 'utf-8')
    const exports = parseFileExports(fileContent)

    let currentLevel = apiStructure
    for (let i = 0; i < objectPathParts.length; i++) {
      const part = objectPathParts[i]
      if (!currentLevel[part]) {
        currentLevel[part] = {}
      }
      currentLevel = currentLevel[part]
    }

    if (
      exports.functions.length > 0 ||
      exports.sseFunctions.length > 0 ||
      exports.streamFunctions.length > 0
    ) {
      for (const functionName of exports.functions) {
        usedImports.add('invokeBackend')
        const clientFunctionCode = `(...args: any[]) => {\n  return invokeBackend('${channelBase}/${toKebabCase(functionName)}', ...args)\n}`
        currentLevel[functionName] = clientFunctionCode
      }

      for (const functionName of exports.sseFunctions) {
        usedImports.add('createSSEConnection')
        const clientFunctionCode = `(...args: any[]) => {\n  return createSSEConnection('${channelBase}/${toKebabCase(functionName)}', args)\n}`
        currentLevel[functionName] = clientFunctionCode
      }

      for (const functionName of exports.streamFunctions) {
        usedImports.add('createStreamConnection')
        const clientFunctionCode = `(...args: any[]) => {\n  return createStreamConnection('${channelBase}/${toKebabCase(functionName)}', ...args)\n}`
        currentLevel[functionName] = clientFunctionCode
      }
    } else {
      console.log(`[generate-api]   No exported functions found in ${filePath}.`)
    }
  }

  // Generate import statement with only used imports
  let generatedCode = `// This file is auto-generated by scripts/generate-api.cjs\n`
  generatedCode += `// Do not modify this file directly.\n`
  generatedCode += `/* eslint-disable */\n\n`

  if (usedImports.size > 0) {
    const importList = Array.from(usedImports).sort().join(', ')
    generatedCode += `import { ${importList} } from '@/api/request'\n\n`
  }

  function generateObjectCode(obj, level = 0) {
    const indent = '  '.repeat(level)
    const innerIndent = '  '.repeat(level + 1)

    const properties = []
    for (const key in obj) {
      if (Object.hasOwnProperty.call(obj, key)) {
        const value = obj[key]
        if (typeof value === 'string') {
          properties.push(`${innerIndent}${key}: ${value}`)
        } else {
          const nestedContent = generateObjectCode(value, level + 1).trim()
          properties.push(`${innerIndent}${key}: {${nestedContent}\n${innerIndent}}`)
        }
      }
    }

    const innerCode = properties.join(',\n')

    if (level === 0) {
      return `export default {\n${innerCode}\n${indent}}\n`
    } else {
      return `${innerCode}`
    }
  }

  generatedCode += generateObjectCode(apiStructure)

  // 确保输出目录存在
  const outputDir = path.dirname(outputFilePath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  fs.writeFileSync(outputFilePath, generatedCode, 'utf-8')

  try {
    execSync(`npx prettier --write "${outputFilePath}"`, {
      stdio: 'pipe',
      cwd: path.join(__dirname, '..')
    })
  } catch (error) {
    // Ignore prettier errors
  }
}

if (require.main === module) {
  generateApiClient().catch(console.error)
} else {
  module.exports = generateApiClient
}
