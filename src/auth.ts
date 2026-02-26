import NextAuth, { type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import dbConnect from "@/lib/mongoose";
import User from "@/models/User";

interface UserAuthProjection {
    _id: { toString(): string };
    username: string;
    passwordHash: string;
    role: "ADMIN" | "CASHIER";
}

function normalizeCredential(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeUsername(value: unknown): string {
    return normalizeCredential(value).toLowerCase();
}

const authConfig = {
    providers: [
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                username: { label: "Username", type: "text" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                const username = normalizeUsername(credentials?.username);
                const password = normalizeCredential(credentials?.password);
                if (!username || !password) return null;

                await dbConnect();
                const user = await User.findOne({ username })
                    .select("_id username passwordHash role")
                    .lean() as UserAuthProjection | null;

                if (!user) {
                    const allowDevCredentials =
                        process.env.NODE_ENV !== "production" &&
                        process.env.AUTH_ALLOW_DEV_CREDENTIALS !== "false";

                    if (allowDevCredentials && username === "admin" && password === "admin") {
                        return {
                            id: "dev-admin",
                            name: "admin",
                            username: "admin",
                            role: "ADMIN"
                        };
                    }

                    return null;
                }

                const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
                if (!isPasswordValid) return null;

                return {
                    id: user._id.toString(),
                    name: user.username,
                    username: user.username,
                    role: user.role
                };
            }
        })
    ],
    pages: {
        signIn: "/login"
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.role = user.role;
                token.username = user.username ?? user.name ?? "";
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.sub || "";
                session.user.role = token.role === "ADMIN" ? "ADMIN" : "CASHIER";
                session.user.username =
                    typeof token.username === "string" && token.username
                        ? token.username
                        : (session.user.name || "");
                session.user.name = session.user.username || session.user.name;
            }
            return session;
        }
    }
} satisfies NextAuthConfig;

export const {
    handlers: { GET, POST },
    auth,
    signIn,
    signOut
} = NextAuth(authConfig);
