import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import AdminTabsNav from '@/pages/admin/components/AdminTabsNav';
import ForumStatsCard from '@/pages/admin/components/ForumStatsCard';
import { ProductVariantSelector } from '@/pages/product-detail/components/ProductVariantSelector';
import { UpgradeModal } from '@/pages/business/dashboard/components/UpgradeModal';

const checkout = vi.hoisted(() => vi.fn());
vi.mock('@/api-services/billing.service', () => ({
  billingService: { createSubscriptionCheckout: checkout },
}));

afterEach(async () => {
  cleanup();
  checkout.mockReset();
  await i18n.changeLanguage('en');
});

describe('localized interface actions', () => {
  it.each([
    ['ru', 'Пользователи', 'Всего тем', 'В наличии: 3', 'Нет в наличии'],
    ['tr', 'Kullanıcılar', 'Toplam konu', 'Stokta 3 adet', 'Tükendi'],
  ])('preserves tab and SKU identifiers in %s', async (locale, users, topics, stock, soldOut) => {
    await i18n.changeLanguage(locale);
    const changeTab = vi.fn();
    const selectSku = vi.fn();
    render(<>
      <AdminTabsNav activeTab="listings" onChangeTab={changeTab} />
      <ForumStatsCard stats={null} />
      <ProductVariantSelector
        variants={[{ id: 1, product_id: 4, name: 'Size', options: ['Small', 'Large'] }]}
        skus={[
          { id: 41, product_id: 4, label: 'Small', options: ['Small'], price: 20, stock: 3 },
          { id: 42, product_id: 4, label: 'Large', options: ['Large'], price: 20, stock: 0 },
        ]}
        selectedSkuId={null}
        onSelectSkuId={selectSku}
      />
    </>);
    fireEvent.click(screen.getByRole('tab', { name: users }));
    expect(changeTab).toHaveBeenCalledWith('users');
    expect(screen.getByText(topics)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Small' })).toHaveAttribute('title', stock);
    expect(screen.getByRole('button', { name: 'Large' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Large' })).toHaveAttribute('title', soldOut);
    fireEvent.click(screen.getByRole('button', { name: 'Small' }));
    expect(selectSku).toHaveBeenCalledWith(41);
  });

  it.each(['ru', 'tr'])('keeps annual checkout canonical and hides provider details in %s', async (locale) => {
    await i18n.changeLanguage(locale);
    checkout.mockRejectedValue(new Error('private billing provider detail'));
    render(<UpgradeModal isOpen onClose={vi.fn()} businessName="Cafe" />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('plans.annual')) }));
    expect(screen.getByText(`/ ${i18n.t('plans.annual')}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('plans.subscribe')) }));
    await waitFor(() => expect(checkout).toHaveBeenCalledWith('annual'));
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('plans.checkoutFailed'));
    expect(screen.queryByText('private billing provider detail')).not.toBeInTheDocument();
  });
});
