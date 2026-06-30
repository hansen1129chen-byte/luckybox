-- Lucky Draw Queue table
CREATE TABLE IF NOT EXISTS lucky_draw_queue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  accept_province VARCHAR(50) DEFAULT '',
  customer_address VARCHAR(500) NOT NULL,
  blind_box_type VARCHAR(10) NOT NULL COMMENT '20k or 50k',
  amount DECIMAL(10,2) NOT NULL,
  paystack_reference VARCHAR(100) DEFAULT '',
  payment_status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending, paid, failed',
  queue_position INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'waiting' COMMENT 'waiting, ordered, cancelled',
  streamer_id INT DEFAULT NULL,
  streamer_name VARCHAR(50) DEFAULT '',
  order_id INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
