db = db.getSiblingDB("9oob");
db.createUser({
  user: "noob",
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: "9oob" }],
});
