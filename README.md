# Auto Migration Data Bot
The bot uses a non-visual data migration from the first ekap.kazatomprom.kz to ekap-v2.kazatomprom.kz, where transferring MySQL data to PostgreSQL would take a lot of time due to the database table relationships, etc. Therefore, this bot simulates migration in offline mode according to a scenario. It is also worth noting that the bot uses WebSocket, which tells us that we can start the migration in multiple threads, increase the load, and perform data migration faster.

## 🚀 Get Started

### Install Bun Runtime (support OS: Windows, Linux, MacOS)
- [[Bun is a fast JavaScript runtime]](https://bun.sh/)

### 🐈‍⬛ Clone project
```bash
git clone git@github.com:yandexphp/auto_migration_data_bot.git

cd auto_migration_data_bot
```

### 🍀 Install Dependencies:

```bash
bun install
```

### 🍙 Run project

```bash
bun run index.ts
```
