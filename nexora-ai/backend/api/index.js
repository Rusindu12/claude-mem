const serverless = require('../dist/serverless');
const handler = serverless.default || serverless;

module.exports = async function nexoraApi(req, res) {
  return handler(req, res);
};
