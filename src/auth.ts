import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

export const {
    handlers: { GET, POST },
    auth,
    signIn,
    signOut,
} = NextAuth({
    providers: [
        CredentialsProvider({
            name: 'Credentials',
            credentials: {
                username: { label: "Username", type: "text" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                // Scaffolding: TODO implement real DB check with bcrypt against User model
                if (credentials?.username === "admin" && credentials?.password === "admin") {
                    return { id: "1", name: "Admin", email: "admin@osgfest.local" };
                }
                return null; // Login failed
            }
        })
    ],
    pages: {
        signIn: '/login',
    }
});
