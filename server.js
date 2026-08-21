import express from "express";
import tableRoutes from "./routes/tableRoutes.js";
import worksheetRoutes from "./routes/worksheetRoutes.js";
import migrationRoutes from "./migration/migrationRoutes.js";

const app = express();
const PORT = 3000;

app.use(express.json());

app.use("/api", tableRoutes);
app.use("/api/worksheet", worksheetRoutes);
app.use("/api/migration", migrationRoutes);

app.use(express.static("public"));
app.use("/migration", express.static("migration"));


app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
