import { Show, SignInButton, SignUpButton, UserButton, useAuth } from '@clerk/react';
import { useEffect } from 'react';
import { isAuthDisabled, setTokenGetter } from '@/lib/auth';
import { Button } from '@/components/ui/Button';

/*
 * Кут авторизації. Токен Clerk кладемо в модуль lib/auth, бо його просять
 * і запити, і EventSource — усі поза деревом React.
 */

function TokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(getToken);
    return () => setTokenGetter(null);
  }, [getToken]);
  return null;
}

export function AuthCorner() {
  // Локальний режим (CLERK_DISABLED=1): жодного компонента Clerk — без
  // валідного ключа вони кидають ще на старті.
  if (isAuthDisabled()) {
    return (
      <span
        className="u-label rounded-full border border-line px-2 py-1 text-[10px]"
        title="CLERK_DISABLED=1 — вхід вимкнено для локальної розробки"
      >
        локально
      </span>
    );
  }

  return (
    <>
      <TokenBridge />
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button size="sm" variant="solid">Увійти</Button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}

/** Повноекранний гейт: без входу панель не показуємо взагалі. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TokenBridge />
      <Show when="signed-out">
        <div className="flex min-h-dvh items-center justify-center p-6">
          <div className="u-measure w-full max-w-md rounded-lg border border-line bg-surface p-7">
            <p className="u-label mb-5">вхід</p>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
              Увійдіть, щоб продовжити
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Кожен акаунт має свого окремого краба — пам'ять і проєкти не перетинаються.
            </p>
            <div className="mt-6 flex gap-2">
              <SignInButton mode="modal">
                <Button variant="solid">Увійти</Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button variant="outline">Створити акаунт</Button>
              </SignUpButton>
            </div>
            <p className="mt-4 text-[12px] text-ink-3">
              Працює в цьому ж вікні — без переходу на інший сайт.
            </p>
          </div>
        </div>
      </Show>
      <Show when="signed-in">{children}</Show>
    </>
  );
}
