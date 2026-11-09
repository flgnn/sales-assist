require("dotenv").config();

const { createApp } = require("./src/app");
const reminderScheduler = require("./src/services/reminderScheduler");

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Sales Assist backend jalan di http://localhost:${PORT}`);
  reminderScheduler.start();
});
