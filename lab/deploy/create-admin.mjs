// Бутстрап главного администратора при установке (deploy/setup.ps1), либо вручную:
//   ADMIN_USERNAME=admin ADMIN_PASSWORD=... node deploy/create-admin.mjs
// Безопасно перезапускать — тот же приём, что prisma/seed.ts в New_Lab_3d: upsert по логину,
// повторный запуск с новым паролем просто сбрасывает пароль существующего админа.
import { createOrUpdateUser, countUsers } from '../db.js';

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD;
const isProduction = process.env.NODE_ENV === 'production';

if (!password) {
  if (isProduction && countUsers() === 0) {
    console.error('Нет ни одного пользователя — задайте ADMIN_PASSWORD (минимум 8 символов).');
    process.exit(1);
  }
  console.log('ADMIN_PASSWORD не задан и пользователи уже есть — ничего не делаю.');
  process.exit(0);
}

if (isProduction && password.length < 8) {
  console.error('ADMIN_PASSWORD должен быть не короче 8 символов в боевой установке.');
  process.exit(1);
}

createOrUpdateUser({ username, password, role: 'admin' });
console.log(`Готово. Логин администратора: ${username}`);
