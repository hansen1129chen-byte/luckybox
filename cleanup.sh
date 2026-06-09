rm -rf /opt/luckybox 2>/dev/null
echo "CLEANED"
curl -s -o /dev/null -w "ROOT:%{http_code} " https://luckyelysian.vip/
echo ""
curl -s -o /dev/null -w "API:%{http_code}" https://luckyelysian.vip/lucky_box/api/health
echo ""
