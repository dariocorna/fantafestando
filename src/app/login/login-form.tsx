"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { loginAction, type LoginActionState } from "./actions";

const initialState: LoginActionState = {
    error: null
};

export function LoginForm(props: { callbackUrl: string }) {
    const [state, action, isPending] = useActionState(loginAction, initialState);

    return (
        <form action={action} className="space-y-4" data-testid="login-form">
            <input type="hidden" name="callbackUrl" value={props.callbackUrl} />
            <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    required
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                />
            </div>

            {state.error ? (
                <p className="text-sm font-medium text-red-600">{state.error}</p>
            ) : null}

            <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? "Accesso in corso..." : "Accedi"}
            </Button>
        </form>
    );
}
