const config = require("./config");
const app = require("./app");

app.listen(config.port, () => {
  console.log(`API do consultório rodando na porta ${config.port} (${config.env})`);
  if (!config.isProd) {
    console.log("Atenção: em produção rode atrás de HTTPS (proxy reverso) com NODE_ENV=production.");
  }
});
