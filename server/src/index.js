const os = require("node:os");
const config = require("./config");
const app = require("./app");

// Escuta em todas as interfaces (0.0.0.0) para que celulares/outras máquinas da rede alcancem a API
app.listen(config.port, "0.0.0.0", () => {
  console.log(`API do consultório rodando na porta ${config.port} (${config.env})`);
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${config.port}`);
  if (ips.length) console.log(`Acesse pela rede em: ${ips.join("  |  ")}`);
  if (!config.isProd) {
    console.log("Atenção: em produção rode atrás de HTTPS (proxy reverso) com NODE_ENV=production.");
  }
});
