const generateApiClient = require('./generate-api.cjs');

const generators = [
  {
    name: 'API 客户端',
    fn: generateApiClient,
    required: true,
    enabled: true
  }
];

async function generateAll(options = {}) {
  const { parallel = true, stopOnError = false } = options;

  const enabledGenerators = generators.filter((g) => g.enabled);

  const results = {
    total: enabledGenerators.length,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  if (parallel) {
    const promises = enabledGenerators.map(async (generator) => {
      try {
        await generator.fn();
        results.success++;
        return { name: generator.name, success: true };
      } catch (error) {
        results.failed++;
        results.errors.push({
          name: generator.name,
          error: error.message,
          required: generator.required
        });

        if (generator.required && stopOnError) {
          throw error;
        }

        return { name: generator.name, success: false, error: error.message };
      }
    });

    await Promise.all(promises);
  } else {
    for (const generator of enabledGenerators) {
      try {
        await generator.fn();
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          name: generator.name,
          error: error.message,
          required: generator.required
        });

        if (generator.required && stopOnError) {
          break;
        }
      }
    }
  }

  const hasRequiredFailure = results.errors.some((e) => e.required);
  if (hasRequiredFailure) {
    throw new Error('必需的代码生成器执行失败');
  }

  return results;
}

async function generateSingle(generatorName) {
  const generator = generators.find(
    (g) =>
      g.name.toLowerCase() === generatorName.toLowerCase() || g.name.toLowerCase().includes(generatorName.toLowerCase())
  );

  if (!generator) {
    throw new Error(`未找到生成器: ${generatorName}`);
  }

  if (!generator.enabled) {
    return;
  }

  await generator.fn();
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    generateSingle(args[0]).catch((error) => {
      console.error('Generate failed:', error);
      process.exit(1);
    });
  } else {
    generateAll().catch((error) => {
      console.error('Generate failed:', error);
      process.exit(1);
    });
  }
} else {
  module.exports = generateAll;
  module.exports.generateAll = generateAll;
  module.exports.generateSingle = generateSingle;
  module.exports.generators = generators;
}
