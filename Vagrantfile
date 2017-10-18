# -*- mode: ruby -*-
# vi: set ft=ruby :
Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/xenial64"
  config.vm.network "private_network", ip: "192.168.33.10"
  config.vm.provision "shell", inline: <<-SHELL
    ## Constants
    export MYSQL_PASSWD="pulldasher"

    ## Install Docker
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
    add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
    apt-get update
    apt-get install -y docker-ce
    usermod -aG docker ubuntu

    ## Install MySQL
    debconf-set-selections <<< "mysql-server mysql-server/root_password password $MYSQL_PASSWD"
    debconf-set-selections <<< "mysql-server mysql-server/root_password_again password $MYSQL_PASSWD"
    apt-get install -y mysql-server
    apt-get install -y mysql-client
    mysql -u root --password=$MYSQL_PASSWD <<< "create database pulldasher;"
    mysql -u root --password=$MYSQL_PASSWD <<< "use pulldasher; source /vagrant/migrations/schema.sql;"

    ## Configure Pulldasher with MySQL
    cp /vagrant/config.example.js /vagrant/config.js
    awk -i inplace '{gsub("mysql remote host URL", "172.17.42.1", $0); print}' /vagrant/config.js
    awk -i inplace '{gsub("database name", "pulldasher", $0); print}' /vagrant/config.js
    awk -i inplace '{gsub("/user: \'username\'", "/user: \'root\'", $0); print}' /vagrant/config.js
    awk -i inplace '{gsub("/pass: \'password\'", "/pass: \'%$MYSQL_PASSWD\'", $0); print}' /vagrant/config.js

    ## Build Pulldasher
    docker build /vagrant/ -t pulldasher:dev

    ## Setup Dev Utils
    echo "docker run -p 8080:8080 pulldasher:dev" > /home/ubuntu/start-pulldasher.sh
    echo "docker stop pulldasher" > /home/ubuntu/stop-pulldasher.sh
    echo "docker rmi pulldasher" > /home/ubuntu/rm-pulldasher.sh
    chmod +x /home/ubuntu/start-pulldasher.sh
    chown ubuntu:ubuntu /home/ubuntu/start-pulldasher.sh
    chmod +x /home/ubuntu/stop-pulldasher.sh
    chown ubuntu:ubuntu /home/ubuntu/stop-pulldasher.sh
    chmod +x /home/ubuntu/rm-pulldasher.sh
    chown ubuntu:ubuntu /home/ubuntu/rm-pulldasher.sh
    ln -s /vagrant/ /home/ubuntu/pulldasher

    ## Explain Dev Setup
    echo "echo 'The ~/pulldasher directory is a linked folder to the machine you launched this VM from'" > /home/ubuntu/.bash_profile
    echo "echo 'Changes you make to the code on the host machine will carry over to this VM'" >> /home/ubuntu/.bash_profile
    echo "echo 'You can build a new pulldasher docker container with: \'docker build /vagrant -t pulldasher:dev\''" >> /home/ubuntu/.bash_profile
    echo "echo 'You can run pulldasher with ~/start-pulldasher'" >> /home/ubuntu/.bash_profile
    echo "echo 'You can stop pulldasher with ~/stop-pulldasher'" >> /home/ubuntu/.bash_profile
    echo "echo 'You can delete the last pulldasher image with ~/rm-pulldasher'" >> /home/ubuntu/.bash_profile
    echo "echo '===================================================================='" >> /home/ubuntu/.bash_profile
    echo "echo 'Almost there!'" >> /home/ubuntu/.bash_profile
    echo "echo 'Just setup a Github Application: https://github.com/settings/applications/new'" >> /home/ubuntu/.bash_profile
    echo "echo 'Fill in the information into config.js'" >> /home/ubuntu/.bash_profile
    echo "echo 'Then build your Dockerfile and run start-pulldasher.sh'" >> /home/ubuntu/.bash_profile
  SHELL
end
