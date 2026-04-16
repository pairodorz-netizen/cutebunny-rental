import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login(email, password);
    navigate('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="absolute top-4 right-4">
        <LocaleSwitcher />
      </div>
      <div className="w-full max-w-sm space-y-6 p-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-primary">CuteBunny</h1>
          <p className="text-muted-foreground">{t('login.title')}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              {t('login.email')}
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@cutebunny.rental"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t('login.password')}
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full">
            {t('login.submit')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <button type="button" className="hover:text-primary transition-colors">
              {t('login.forgotPassword')}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
