require("dotenv").config();

const express = require("express");
const app = express();

require("./bot");

app.get("/", (req, res) => {
  res.send("Doctor Appointment Bot Running");
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});