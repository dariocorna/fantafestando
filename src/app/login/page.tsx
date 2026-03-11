import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

interface LoginPageProps {
    searchParams?: Promise<{
        callbackUrl?: string;
    }>;
}

function resolveCallbackUrl(value: string | undefined): string {
    if (!value || !value.startsWith("/") || value.startsWith("//")) {
        return "/admin";
    }
    return value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
    const session = await auth();
    if (session?.user?.role === "ADMIN") {
        redirect("/admin");
    }
    if (session?.user) {
        redirect("/pos");
    }

    const params = searchParams ? await searchParams : undefined;
    const callbackUrl = resolveCallbackUrl(params?.callbackUrl);

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
            <Card className="w-full max-w-sm shadow-lg">
                <CardHeader>
                    <CardTitle>Login FantaFestando</CardTitle>
                    <CardDescription>Accedi con un utente autorizzato al backoffice.</CardDescription>
                </CardHeader>
                <CardContent>
                    <LoginForm callbackUrl={callbackUrl} />
                </CardContent>
            </Card>
        </div>
    );
}
