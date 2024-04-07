REGISTRY=gcr.io/gecko
if [ "$1" = "cc" ]; then
    PREFIX=buildx
    PLATFORM=--platform=linux/amd64
fi
CURRENT_HASH=`tar cvf - . 2>/dev/null | sha1sum | awk '{print $1}'`

#
#docker $PREFIX build . -f ./deploy/jenkins/Dockerfile $PLATFORM -t $REGISTRY/jenkins:$CURRENT_HASH
#docker push $REGISTRY/jenkins:latest
#
#kubectl apply -f ./deploy/jenkins/jenkins.yaml
#

# stats-backend
docker $PREFIX build . -f ./deploy/stats-backend/Dockerfile $PLATFORM -t $REGISTRY/stats-backend:$CURRENT_HASH
docker push $REGISTRY/stats-backend:$CURRENT_HASH
sed "s/REPLACE_ME_HASH/$CURRENT_HASH/g" deploy/stats-backend/backend.yaml > .new.backend.yaml
kubectl apply -f .new.backend.yaml

# frontend
docker $PREFIX build . -f ./deploy/frontend/Dockerfile $PLATFORM -t $REGISTRY/frontend:$CURRENT_HASH
docker push $REGISTRY/frontend:$CURRENT_HASH
sed "s/REPLACE_ME_HASH/$CURRENT_HASH/g" deploy/frontend/frontend.yaml > .new.frontend.yaml
kubectl apply -f .new.frontend.yaml

# ipfs
docker $PREFIX build . -f ./deploy/ipfs-gateway/Dockerfile $PLATFORM -t $REGISTRY/ipfs-gateway:$CURRENT_HASH
docker push $REGISTRY/ipfs-gateway:$CURRENT_HASH
sed "s/REPLACE_ME_HASH/$CURRENT_HASH/g" deploy/ipfs-gateway/gateway.yaml > .new.ipfs-gateway.yaml
kubectl apply -f .new.ipfs-gateway.yaml
kubectl expose deployment ipfs-gateway --port=4000 --target-port=4000

# price estimator
docker $PREFIX build . -f ./deploy/price-estimator/Dockerfile $PLATFORM -t $REGISTRY/price-estimator:$CURRENT_HASH
docker push $REGISTRY/price-estimator:$CURRENT_HASH
sed "s/REPLACE_ME_HASH/$CURRENT_HASH/g" deploy/price-estimator/price-estimator.yaml > .new.price-estimator.yaml
kubectl apply -f .new.price-estimator.yaml
kubectl expose deployment price-estimator --port=4001 --target-port=4001

# landing
docker $PREFIX build . -f ./deploy/landing/Dockerfile $PLATFORM -t $REGISTRY/landing:$CURRENT_HASH
docker push $REGISTRY/landing:$CURRENT_HASH
sed "s/REPLACE_ME_HASH/$CURRENT_HASH/g" deploy/landing/landing.yaml > .new.landing.yaml
kubectl apply -f .new.landing.yaml
kubectl expose deployment landing --port=3000 --target-port=3000

docker buildx build . -f deploy/fuzzer/Dockerfile -t gecko/cli
docker push gecko/cli