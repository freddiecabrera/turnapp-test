import bcrypt from "bcryptjs";
import { asyncRouter } from "../async-router";
import { prisma } from "../prisma";
import { requireAuth, signToken } from "../auth";
import { toPublicUser } from "../serialize";

export const authRouter = asyncRouter();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken({ userId: user.id, isAdmin: user.isAdmin });
  return res.json({ token, user: toPublicUser(user) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(toPublicUser(user));
});
