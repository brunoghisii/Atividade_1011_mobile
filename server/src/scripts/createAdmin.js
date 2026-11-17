// Cria o primeiro administrador. Não existe usuário/senha padrão no sistema.
// Uso: npm run create-admin -- "Nome" email@clinica.com
// A senha é lida da variável ADMIN_PASSWORD (para não ficar no histórico do terminal).
const crypto = require("node:crypto");
const { db } = require("../db");
const { password: passwordSchema, z } = require("../security/validate");
const { hashPassword } = require("../security/auth");

(async () => {
  const [name, email] = process.argv.slice(2);
  const pwd = process.env.ADMIN_PASSWORD;
  const check = z
    .object({ name: z.string().min(2), email: z.email(), pwd: passwordSchema })
    .safeParse({ name, email, pwd });
  if (!check.success) {
    console.error('Uso: ADMIN_PASSWORD="SenhaForte#123" npm run create-admin -- "Nome" email@clinica.com');
    console.error(check.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
  }
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
    console.error("E-mail já cadastrado.");
    process.exit(1);
  }
  db.prepare("INSERT INTO users (id, name, email, role, password_hash) VALUES (?, ?, ?, 'admin', ?)").run(
    crypto.randomUUID(),
    name,
    email.toLowerCase(),
    await hashPassword(pwd)
  );
  console.log(`Administrador ${email} criado.`);
})();
